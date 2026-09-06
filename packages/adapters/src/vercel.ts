import { Sandbox, type SandboxRegion } from '@vercel/sandbox';
import { createHash } from 'node:crypto';
import { Uncertain, SetupRequired } from '@r2cloud/contracts/adapters';
export type VercelIdentity = { operationId: string; runId: string; generation: number };
export type VercelPlan = {
  image: string;
  region: SandboxRegion;
  minutes: number;
  vcpus: 2 | 4;
  // Approved clean base image only. Repository material is transferred by the supervisor.
};
export type Allocation = VercelIdentity & {
  name: string;
  configHash: string;
  state: string;
  stopProof?: string | null;
};
export interface SandboxJournal {
  reserve(
    identity: VercelIdentity,
    name: string,
    configHash: string,
    minutes: number,
  ): Promise<{ fresh: boolean; allocation: Allocation }>;
  get(identity: VercelIdentity): Promise<Allocation | null>;
  mark(identity: VercelIdentity, state: string, stopProof?: string): Promise<void>;
  beginStep(
    identity: VercelIdentity,
    key: string,
    payloadHash: string,
  ): Promise<{ fresh: boolean; result?: unknown }>;
  finishStep(identity: VercelIdentity, key: string, result: unknown): Promise<void>;
}
type SDK = Pick<typeof Sandbox, 'create' | 'get'>;
export const sandboxDigest = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** Cloud control plane only. Never executes repository code in the API/worker host. */
export class VercelSandboxes {
  constructor(
    private credentials: { token: string; teamId: string; projectId: string },
    private journal: SandboxJournal,
    private sdk: SDK = Sandbox,
  ) {
    if (!credentials.token || !credentials.teamId || !credentials.projectId)
      throw new SetupRequired('Configure the project-specific Vercel Sandbox credentials.');
  }
  async ensure(identity: VercelIdentity, plan: VercelPlan) {
    if (
      !plan.region ||
      !/^[\w./-]+@sha256:[a-f0-9]{64}$/.test(plan.image) ||
      !Number.isInteger(plan.minutes) ||
      plan.minutes < 1 ||
      plan.minutes > 60 ||
      ![2, 4].includes(plan.vcpus)
    )
      throw new SetupRequired(
        'A digest-pinned sandbox image, region and bounded resources are required.',
      );
    const configHash = sandboxDigest({ identity, plan });
    const name = `r2-${sandboxDigest(identity).slice(0, 40)}`;
    const { fresh, allocation } = await this.journal.reserve(
      identity,
      name,
      configHash,
      plan.minutes,
    );
    if (allocation.configHash !== configHash)
      throw new Error('Sandbox configuration changed for an existing execution.');
    if (!fresh) {
      if (allocation.state === 'stopped' || allocation.state === 'stopping')
        throw new Uncertain('This execution cannot be resumed.');
      const sandbox = await this.existing(identity, allocation);
      await this.journal.mark(identity, 'running');
      return sandbox;
    }
    try {
      const sandbox = await this.sdk.create({
        ...this.credentials,
        name,
        image: plan.image,
        region: plan.region,
        failoverRegions: [],
        resources: { vcpus: plan.vcpus },
        timeout: plan.minutes * 60_000,
        persistent: false,
        ports: [],
        env: {},
        networkPolicy: 'deny-all',
        tags: {
          r2run: identity.runId,
          r2generation: String(identity.generation),
          r2config: configHash,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (sandbox.name !== name || sandbox.status !== 'running')
        throw new Uncertain('Sandbox launch is not confirmed.');
      await this.journal.mark(identity, 'running');
      return sandbox;
    } catch {
      await this.journal.mark(identity, 'uncertain');
      throw new Uncertain('Sandbox creation has an uncertain outcome; replacement is blocked.');
    }
  }
  private async existing(identity: VercelIdentity, allocation: Allocation) {
    try {
      // Reading lifecycle state must never wake a stopped sandbox.
      const sandbox = await this.sdk.get({
        ...this.credentials,
        name: allocation.name,
        resume: false,
        signal: AbortSignal.timeout(15_000),
      });
      if (
        sandbox.status !== 'running' ||
        sandbox.tags?.r2config !== allocation.configHash ||
        sandbox.tags?.r2run !== identity.runId ||
        sandbox.tags?.r2generation !== String(identity.generation)
      )
        throw new Uncertain('Sandbox identity or running state is not confirmed.');
      return sandbox;
    } catch {
      throw new Uncertain('Existing sandbox could not be confirmed; replacement is blocked.');
    }
  }
  async observe(identity: VercelIdentity) {
    const allocation = await this.journal.get(identity);
    if (!allocation) return { state: 'absent' as const };
    if (allocation.state === 'stopped')
      return { state: 'stopped' as const, stopProof: allocation.stopProof };
    try {
      await this.existing(identity, allocation);
      return { state: 'running' as const };
    } catch {
      return { state: 'unknown' as const };
    }
  }
  async command(
    identity: VercelIdentity,
    key: string,
    command: { cmd: string; args: string[]; cwd: string },
  ) {
    if (
      !key ||
      key.length > 160 ||
      !command.cmd ||
      command.args.some((x) => typeof x !== 'string') ||
      !command.cwd.startsWith('/vercel/sandbox/') ||
      command.cwd.split('/').includes('..')
    )
      throw new Error('Invalid supervisor command.');
    const allocation = await this.journal.get(identity);
    if (!allocation || allocation.state !== 'running')
      throw new Uncertain('Sandbox is not reserved for commands.');
    const receipt = await this.journal.beginStep(identity, key, sandboxDigest(command));
    if (!receipt.fresh) {
      if (receipt.result !== undefined) return receipt.result as { exitCode: number };
      throw new Uncertain('Command outcome is unknown; it must not be replayed.');
    }
    const sandbox = await this.existing(identity, allocation);
    const result = await sandbox
      .currentSession()
      .runCommand({ ...command, env: {}, timeoutMs: 60_000, signal: AbortSignal.timeout(65_000) });
    const value = { exitCode: result.exitCode };
    await this.journal.finishStep(identity, key, value);
    return value;
  }
  async snapshotAndStop(identity: VercelIdentity) {
    const allocation = await this.journal.get(identity);
    if (!allocation || allocation.state !== 'running')
      throw new Uncertain('Sandbox is not ready for snapshotting.');
    const receipt = await this.journal.beginStep(
      identity,
      'snapshot',
      sandboxDigest({ retentionDays: 7 }),
    );
    if (!receipt.fresh)
      throw new Uncertain('Snapshot was already requested; reconcile its outcome before retrying.');
    // Snapshotting stops the session. Keep intake closed even if the response is lost.
    await this.journal.mark(identity, 'stopping');
    const sandbox = await this.existing(identity, allocation);
    const snapshot = await sandbox
      .currentSession()
      .snapshot({ expiration: 7 * 24 * 3600_000, signal: AbortSignal.timeout(30_000) });
    await this.journal.finishStep(identity, 'snapshot', { snapshotId: snapshot.snapshotId });
    const stopProof = await this.stop(identity);
    return { snapshotId: snapshot.snapshotId, stopProof };
  }
  async stop(identity: VercelIdentity) {
    const allocation = await this.journal.get(identity);
    if (!allocation) throw new Uncertain('No sandbox allocation is recorded.');
    if (allocation.state === 'stopped') return allocation.stopProof;
    if (allocation.state !== 'stopping') await this.journal.mark(identity, 'stopping');
    try {
      const sandbox = await this.sdk.get({
        ...this.credentials,
        name: allocation.name,
        resume: false,
        signal: AbortSignal.timeout(15_000),
      });
      if (sandbox.tags?.r2config !== allocation.configHash)
        throw new Uncertain('Sandbox identity mismatch.');
      const result = await sandbox.stop({ signal: AbortSignal.timeout(30_000) });
      if (result.status !== 'stopped') throw new Uncertain('Stop is not confirmed.');
      const proof = sandboxDigest({
        provider: 'vercel',
        name: allocation.name,
        identity,
        status: result.status,
      });
      await this.journal.mark(identity, 'stopped', proof);
      return proof;
    } catch {
      throw new Uncertain('Sandbox stop is not confirmed; ownership remains reserved.');
    }
  }
}
