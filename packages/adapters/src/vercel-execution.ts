import { codexNetworkPolicy } from './codex-network';
import { sandboxPath, bunIntegrity, installBun } from './sandbox-bun';
import { type Sandbox, type Session } from '@vercel/sandbox';
import { createHash } from 'node:crypto';
import { mkdir, open, rename, rm, statfs, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { executionProfile } from '@r2cloud/contracts/execution';
import { digest } from '@r2cloud/contracts/hash';
import {
  SetupRequired,
  Uncertain,
  type ExecutionBackend,
  type Observation,
  type RunGrant,
  type RunResult,
} from '@r2cloud/contracts/adapters';
import { VercelSandboxes, sandboxDigest, type SandboxJournal, type VercelIdentity } from './vercel';
import type { CodexModel } from '@r2cloud/contracts/threads';
import { CodexHarness } from './codex';
import { codexBridge, VercelCodexTransport } from './vercel-codex-transport';

export type ExecutionCredentials = {
  accessToken: string;
  accountId: string;
  plan: string;
  expiresAt: number;
};
export type ExecutionControl = {
  authorize(grant: RunGrant): Promise<ExecutionCredentials>;
  recover(
    operationId: string,
  ): Promise<{ identity: VercelIdentity; result: RunResult | null } | null>;
  progress(grant: RunGrant, message: string): Promise<void>;
  reply?(grant: RunGrant, message: string): Promise<void>;
  models?(grant: RunGrant, models: CodexModel[]): Promise<void>;
  previousArtifact(grant: RunGrant): Promise<{ digest: string; headSha: string }>;
};
export class VercelCodexExecution implements ExecutionBackend {
  readonly mode = 'managed';
  private cloud: VercelSandboxes;
  constructor(
    private credentials: { token: string; teamId: string; projectId: string },
    private image: string,
    private artifacts: string,
    private journal: SandboxJournal,
    private control: ExecutionControl,
    private http: typeof fetch = fetch,
    sdk?: Pick<typeof Sandbox, 'create' | 'get'>,
  ) {
    this.cloud = new VercelSandboxes(credentials, journal, sdk);
  }
  async observe(operationId: string): Promise<Observation<RunResult>> {
    const previous = await this.control.recover(operationId);
    if (!previous) return { state: 'absent' };
    if (previous.result) return { state: 'finished', result: previous.result };
    const observed = await this.cloud.observe(previous.identity);
    return { state: observed.state === 'running' ? 'running' : 'unknown' };
  }
  async start(grant: RunGrant): Promise<RunResult> {
    const pinned = grant.config.executionSetup;
    const setup = executionProfile.parse(pinned?.config);
    if (
      !pinned ||
      digest(setup) !== pinned.digest ||
      grant.config.budgetCents !== 0 ||
      grant.config.minutes > 10 ||
      grant.config.minutes > setup.maxMinutes ||
      setup.vcpus !== 2
    )
      throw new SetupRequired(
        'This pilot requires a verified profile, two CPUs and at most ten minutes with no paid allowance.',
      );
    if (grant.config.skills.length)
      throw new SetupRequired('Managed skill mounting is not configured.');
    if (
      !/^[-\w.]+\/[-\w.]+$/.test(grant.config.repository) ||
      !/^[a-f0-9]{40}$/.test(grant.config.baseSha)
    )
      throw new SetupRequired('Invalid repository identity.');
    await this.assertHobby();
    const account = await this.control.authorize(grant);
    const deadline = Date.now() + grant.config.minutes * 60000;
    if (account.expiresAt < deadline + 60000)
      throw new SetupRequired(
        'Reconnect Codex before starting this run; the current credential expires too soon.',
      );
    const repository = await this.http(`https://api.github.com/repos/${grant.config.repository}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!repository.ok || (await repository.json()).private !== false)
      throw new SetupRequired(
        'This pilot currently imports public repositories only. Private repositories need the installation credential broker.',
      );
    const identity = {
      operationId: grant.operationId,
      runId: grant.runId,
      generation: grant.generation,
    };
    const sandbox = await this.cloud.ensure(identity, {
      image: this.image,
      region: 'cdg1',
      minutes: grant.config.minutes,
      vcpus: 2,
    });
    const session = sandbox.currentSession();
    let stage = 'Sandbox setup';
    const progress = async (message: string) => {
      stage = message;
      await this.control.progress(grant, message);
    };
    let checking = false;
    let revoked = false;
    const monitor = setInterval(() => {
      if (checking || revoked) return;
      checking = true;
      void this.control
        .authorize(grant)
        .catch(async () => {
          revoked = true;
          try {
            await sandbox.updateNetworkPolicy('deny-all');
          } finally {
            await this.cloud.stop(identity);
          }
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    }, 10000);
    const checkout = '/vercel/sandbox/repository';
    const cwd = setup.directory === '.' ? checkout : `${checkout}/${setup.directory}`;
    const once = async <T>(key: string, input: unknown, execute: () => Promise<T>): Promise<T> => {
      const receipt = await this.journal.beginStep(identity, key, sandboxDigest(input));
      if (receipt.result !== undefined) return receipt.result as T;
      if (!receipt.fresh) throw new Uncertain(`${key} has an unresolved outcome.`);
      const result = await execute();
      await this.journal.finishStep(identity, key, result);
      return result;
    };
    const run = async (cmd: string, args: string[], directory = cwd, timeout = 60000) => {
      const remaining = Math.min(timeout, deadline - Date.now());
      if (remaining < 1000) throw new Uncertain('Execution time limit reached.');
      const result = await session.runCommand({
        cmd: 'runuser',
        args: ['-u', 'r2-agent', '--', 'env', `PATH=${sandboxPath}`, cmd, ...args],
        sudo: true,
        cwd: directory,
        env: { PATH: sandboxPath },
        timeoutMs: remaining,
        signal: AbortSignal.timeout(remaining + 5000),
      });
      return result;
    };
    try {
      await once('isolation', { user: 'r2-agent', checkout }, async () => {
        for (const [cmd, ...args] of [
          ['useradd', '--create-home', '--shell', '/bin/bash', 'r2-agent'],
          ['mkdir', '-p', checkout],
          ['chown', 'r2-agent:r2-agent', checkout],
        ]) {
          const result = await session.runCommand({
            cmd: cmd!,
            args,
            sudo: true,
            timeoutMs: 15000,
            signal: AbortSignal.timeout(20000),
          });
          if (result.exitCode !== 0)
            throw new SetupRequired('Sandbox user isolation could not be established.');
        }
        const controlDirectory = await session.runCommand({
          cmd: 'mkdir',
          args: ['-m', '700', '/tmp/r2cloud-control'],
          timeoutMs: 15000,
        });
        if (controlDirectory.exitCode !== 0)
          throw new SetupRequired('Sandbox control isolation could not be established.');
        return { isolated: true };
      });
      await progress('Preparing the repository');
      await sandbox.updateNetworkPolicy(codexNetworkPolicy(grant.config.repository));
      await once(
        'checkout',
        { repository: grant.config.repository, sha: grant.config.baseSha },
        async () => {
          for (const [cmd, ...args] of [
            ['mkdir', '-p', checkout],
            ['git', '-C', checkout, 'init'],
            [
              'git',
              '-C',
              checkout,
              'remote',
              'add',
              'origin',
              `https://github.com/${grant.config.repository}.git`,
            ],
            [
              'git',
              '-C',
              checkout,
              '-c',
              'core.hooksPath=/dev/null',
              'fetch',
              '--depth=1',
              'origin',
              grant.config.baseSha,
            ],
            [
              'git',
              '-C',
              checkout,
              '-c',
              'core.hooksPath=/dev/null',
              'checkout',
              '--detach',
              'FETCH_HEAD',
            ],
          ])
            if ((await run(cmd!, args, '/tmp')).exitCode !== 0)
              throw new Error('Repository preparation failed.');
          return { imported: true };
        },
      );
      if (grant.config.previousCandidate) {
        const previous = await this.control.previousArtifact(grant);
        await once('restore-candidate', previous, async () => {
          const bundle = await readFile(join(resolve(this.artifacts), `${previous.digest}.bundle`));
          if (
            bundle.length > 64 * 1024 ** 2 ||
            createHash('sha256').update(bundle).digest('hex') !== previous.digest
          )
            throw new Error('Previous candidate artifact is invalid.');
          await session.writeFiles([{ path: '/tmp/r2cloud-previous.bundle', content: bundle }]);
          for (const args of [
            ['-c', 'core.hooksPath=/dev/null', 'fetch', '/tmp/r2cloud-previous.bundle', 'HEAD'],
            ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', previous.headSha],
          ])
            if ((await run('git', args, checkout)).exitCode !== 0)
              throw new Error('Previous candidate could not be restored.');
          return { restored: true };
        });
      }
      await progress('Preparing the Bun runtime');
      await once('bun-runtime', { version: '1.4.2', integrity: bunIntegrity }, async () => {
        await session.writeFiles([
          { path: '/tmp/r2cloud-install-bun.py', content: installBun, mode: 0o600 },
        ]);
        const installed = await session.runCommand({
          cmd: 'python3',
          args: ['/tmp/r2cloud-install-bun.py'],
          sudo: true,
          timeoutMs: 90000,
          signal: AbortSignal.timeout(95000),
        });
        if (installed.exitCode !== 0)
          throw new SetupRequired('The pinned Bun runtime could not be installed.');
        const version = (await (await run('bun', ['--version'], '/tmp')).stdout()).trim();
        if (version !== '1.4.2')
          throw new SetupRequired('The sandbox Bun version does not match the project toolchain.');
        return { version };
      });
      await progress('Installing project dependencies');
      await once('install', setup.install, async () => {
        const result = await run(setup.install.cmd, setup.install.args, cwd, 180000);
        if (result.exitCode !== 0)
          throw new Error(
            'Dependency installation failed. Check the repository execution settings.',
          );
        return { exitCode: result.exitCode };
      });
      await sandbox.updateNetworkPolicy(codexNetworkPolicy(grant.config.repository, account));
      await once('codex-process', { version: '0.147.0', bridge: digest(codexBridge) }, async () => {
        const version = await run('codex', ['--version']);
        if ((await version.stdout()).trim() !== 'codex-cli 0.147.0')
          throw new SetupRequired('The sandbox Codex version changed.');
        await session.writeFiles([
          { path: '/tmp/r2cloud-bridge.py', content: codexBridge, mode: 0o600 },
        ]);
        const process = await session.runCommand({
          cmd: 'python3',
          args: ['/tmp/r2cloud-bridge.py'],
          sudo: true,
          cwd: '/tmp',
          env: { PATH: sandboxPath },
          detached: true,
        });
        return { commandId: process.cmdId };
      });
      const transport = new VercelCodexTransport(
        session,
        this.journal,
        identity,
        deadline - 120000,
      );
      const harness = new CodexHarness(transport);
      await harness.initialize(grant.operationId);
      const placeholder = [
        Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(
          JSON.stringify({
            sub: 'r2cloud-network-broker',
            exp: Math.floor(deadline / 1000),
            'https://api.openai.com/auth': {
              chatgpt_account_id: account.accountId,
              chatgpt_plan_type: account.plan,
            },
          }),
        ).toString('base64url'),
        'placeholder',
      ].join('.');
      await transport.requestOnce(`${grant.operationId}:login`, 'account/login/start', {
        type: 'chatgptAuthTokens',
        accessToken: placeholder,
        chatgptAccountId: account.accountId,
        chatgptPlanType: account.plan,
      });
      const models = await harness.models(`${grant.operationId}:models`);
      await this.control.models?.(grant, models);
      const selectedModel = grant.config.thread?.model;
      if (selectedModel && !models.some((model) => model.model === selectedModel))
        throw new SetupRequired('The selected model is no longer available. Choose another model.');
      const { thread } = await harness.start(`${grant.operationId}:thread`, cwd, selectedModel);
      await this.control.authorize(grant);
      await progress('Codex is working on the task');
      const { turn } = await harness.input(
        `${grant.operationId}:turn`,
        thread.id,
        JSON.stringify({
          outcome: grant.outcome,
          acceptanceCriteria: grant.criteria,
          threadInstructions: grant.config.thread?.instructions,
          feedback: grant.feedback,
          instructions:
            'Only implement an explicitly requested product or code change in the checkout. If the request is a greeting, conversational question, or unclear outcome, respond conversationally or ask for clarification; do not invent a code change. Do not publish, push, open pull requests, or merge. Keep changes focused. Summarize changes and limitations.',
        }),
      );
      if ((await transport.waitForTurn(thread.id, turn.id)).status !== 'completed')
        throw new Error('Codex did not finish this turn.');
      const reply = await transport.read<{ text: string }>('message.json');
      await this.control.authorize(grant);
      if (typeof reply?.text === 'string' && reply.text.trim())
        await this.control.reply?.(grant, reply.text);
      await sandbox.updateNetworkPolicy(codexNetworkPolicy(grant.config.repository));
      if (revoked) throw new SetupRequired('Codex access was revoked during this run.');
      await this.control.authorize(grant);
      await progress('Checking the changes');
      const checks: { cmd: string; exitCode: number }[] = [];
      for (const [index, test] of setup.tests.entries())
        checks.push(
          await once(`check:${index}`, test, async () => ({
            cmd: test.cmd,
            exitCode: (await run(test.cmd, test.args, cwd, 180000)).exitCode,
          })),
        );
      await once('candidate-commit', { runId: grant.runId }, async () => {
        for (const args of [
          ['-c', 'core.hooksPath=/dev/null', 'add', '--all'],
          [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'user.name=R2Cloud Agent',
            '-c',
            'user.email=agent@r2cloud.invalid',
            'commit',
            '--allow-empty',
            '-m',
            `Task ${grant.taskId}`,
          ],
          [
            '-c',
            'core.hooksPath=/dev/null',
            'bundle',
            'create',
            '/tmp/r2cloud-candidate.bundle',
            'HEAD',
          ],
        ])
          if ((await run('git', args, checkout)).exitCode !== 0)
            throw new Error('Candidate export failed.');
        return { committed: true };
      });
      const headSha = (await (await run('git', ['rev-parse', 'HEAD'], checkout)).stdout()).trim();
      if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Invalid candidate commit.');
      const artifactDigest = await this.store(session, grant.runId);
      await this.journal.beginStep(identity, 'result', digest({ runId: grant.runId }));
      const stopProof = await this.cloud.stop(identity);
      if (!stopProof) throw new Uncertain('Execution stop could not be verified.');
      const result: RunResult = {
        manifest: {
          orgId: grant.orgId,
          projectId: grant.projectId,
          taskId: grant.taskId,
          runId: grant.runId,
          generation: grant.generation,
          repository: grant.config.repository,
          targetRef: grant.config.targetRef,
          branch: `r2cloud/task-${grant.taskId}`,
          baseSha: grant.config.baseSha,
          headSha,
          artifactDigest,
          summary:
            typeof reply?.text === 'string'
              ? reply.text.slice(0, 4000)
              : 'Codex prepared a candidate for product review.',
          limitations: [
            ...checks.map((x) => `${x.cmd}: exit ${x.exitCode}`),
            'Product acceptance criteria need human verification.',
            'Private browser preview and publication are not enabled for this pilot yet.',
          ],
          fixture: false,
        },
        evidence: {
          checks: grant.criteria.map((name) => ({
            name,
            status: checks.some((x) => x.exitCode !== 0) ? 'failed' : 'unknown',
          })),
          snapshotDigest: artifactDigest,
          preview: { available: false, fixture: false },
        },
        stopProof,
      };
      await this.journal.finishStep(identity, 'result', result);
      return result;
    } catch (error) {
      try {
        await sandbox.updateNetworkPolicy('deny-all');
      } finally {
        await this.cloud.stop(identity);
      }
      throw error instanceof SetupRequired || error instanceof Uncertain
        ? error
        : new Error(`Execution stopped during: ${stage}. No changes were published.`);
    } finally {
      clearInterval(monitor);
    }
  }
  private async assertHobby() {
    const response = await this.http(
      `https://api.vercel.com/v2/teams/${encodeURIComponent(this.credentials.teamId)}`,
      {
        headers: { Authorization: `Bearer ${this.credentials.token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok || (await response.json()).billing?.plan !== 'hobby')
      throw new SetupRequired(
        'An active Vercel Hobby connection is required for free-only execution.',
      );
  }
  private async store(session: Session, runId: string) {
    const root = resolve(this.artifacts);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < 21 * 1024 ** 3)
      throw new Error('Artifact storage needs at least 21 GiB free.');
    const temp = join(root, `${runId}.partial`);
    const file = await open(temp, 'wx', 0o600);
    const hash = createHash('sha256');
    try {
      const stream = await session.readFile(
        { path: '/tmp/r2cloud-candidate.bundle' },
        { signal: AbortSignal.timeout(30000) },
      );
      if (!stream) throw new Error('Candidate artifact is missing.');
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 64 * 1024 ** 2)
          throw new Error('Candidate exceeds the 64 MiB pilot artifact limit.');
        hash.update(bytes);
        await file.writeFile(bytes);
      }
      await file.sync();
      await file.close();
      const digest = hash.digest('hex');
      await rename(temp, join(root, `${digest}.bundle`));
      return digest;
    } finally {
      await file.close();
      await rm(temp, { force: true });
    }
  }
}
