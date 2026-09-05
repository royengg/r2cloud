import { executionProfile, type PinnedExecutionProfile } from '@r2cloud/contracts/execution';
import { digest } from '@r2cloud/contracts/hash';
import { CodexHarness, type CodexTransport } from './codex';
import {
  SetupRequired,
  type ExecutionBackend,
  type Observation,
  type RunGrant,
  type RunResult,
} from '@r2cloud/contracts/adapters';
export type SandboxSpec = {
  executionSetup: PinnedExecutionProfile;
  identity: string;
  generation: number;
  architecture: 'provider-image';
  repository: string;
  baseSha: string;
  checkout: string;
  minutes: number;
  budgetCents: number;
  skills: RunGrant['config']['skills'];
  networkPolicy: 'approved-repository-and-model-only';
  githubWrites: false;
  inheritHostEnvironment: false;
  inheritProviderConfig: false;
  isolatedBrowser: true;
  previousCandidate?: string;
};
export interface ManagedSandbox {
  /** Supervisor durably deduplicates each step and reconciles uncertain launches. */
  transport: CodexTransport;
  waitForTurn(
    threadId: string,
    turnId: string,
  ): Promise<{ status: 'completed' | 'failed' | 'interrupted' }>;
  /** Separate test/browser checks, immutable export, AND process quiescence attestation. */
  checkSnapshotAndStop(grant: RunGrant): Promise<RunResult>;
}
export interface ManagedSandboxProvider {
  observe(operationId: string): Promise<Observation<RunResult>>;
  ensure(operationId: string, spec: SandboxSpec): Promise<ManagedSandbox>;
}
export class ManagedCodexExecution implements ExecutionBackend {
  readonly mode = 'managed' as const;
  constructor(private provider: ManagedSandboxProvider) {}
  observe(operationId: string) {
    return this.provider.observe(operationId);
  }
  async start(g: RunGrant): Promise<RunResult> {
    const pinned = g.config.executionSetup;
    if (!pinned || !Number.isInteger(pinned.version) || pinned.version < 1)
      throw new SetupRequired('A pinned execution setup is required.');
    const setup = executionProfile.parse(pinned.config);
    if (
      digest(setup) !== pinned.digest ||
      g.config.minutes > setup.maxMinutes ||
      g.config.budgetCents > setup.maxBudgetCents
    )
      throw new SetupRequired('Execution setup identity or limits are invalid.');
    const sandbox = await this.provider.ensure(g.operationId, {
      executionSetup: pinned,
      identity: g.runId,
      generation: g.generation,
      architecture: 'provider-image',
      repository: g.config.repository,
      baseSha: g.config.baseSha,
      checkout: '/vercel/sandbox/repository',
      minutes: g.config.minutes,
      budgetCents: g.config.budgetCents,
      skills: g.config.skills,
      networkPolicy: 'approved-repository-and-model-only',
      githubWrites: false,
      inheritHostEnvironment: false,
      inheritProviderConfig: false,
      isolatedBrowser: true,
      previousCandidate: g.config.previousCandidate,
    });
    const codex = new CodexHarness(sandbox.transport);
    codex.on('permission', (p) => {
      void codex.denyPermission(p.id).catch(() => {
        /* Supervisor must retain blocked state on transport loss. */
      });
    });
    await codex.initialize(g.operationId);
    const health = await codex.health(`${g.operationId}:auth`);
    if (!health.account)
      throw new SetupRequired('The scoped Codex connection needs authentication.');
    const cwd =
      '/vercel/sandbox/repository' + (setup.directory === '.' ? '' : '/' + setup.directory);
    const { thread } = await codex.start(`${g.operationId}:thread`, cwd);
    const { turn } = await codex.input(
      `${g.operationId}:turn`,
      thread.id,
      JSON.stringify({ outcome: g.outcome, acceptanceCriteria: g.criteria, feedback: g.feedback }),
    );
    const ended = await sandbox.waitForTurn(thread.id, turn.id);
    if (ended.status !== 'completed')
      throw new Error(
        `Codex turn ${ended.status}; execution remains reserved until supervisor reconciliation.`,
      );
    return sandbox.checkSnapshotAndStop(g);
  }
}
