import { readFileSync } from 'node:fs';
import type { Sandbox } from '@vercel/sandbox';
import type { RunGrant, RunResult } from '@r2cloud/contracts/adapters';
import { executionProfile } from '@r2cloud/contracts/execution';
import { digest } from '@r2cloud/contracts/hash';
import { sandboxPath, installBun } from './sandbox-bun';
import { codexNetworkPolicy } from './codex-network';
import type { ExecutionCredentials } from './vercel-execution';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, statfs, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const recoveryScript = readFileSync(new URL('./recovery-snapshot.ts', import.meta.url), 'utf8');

export class TaskCheckout {
  get path() {
    return this.purpose === 'preview'
      ? '/vercel/sandbox/r2-previews/source'
      : '/vercel/sandbox/agent/repository';
  }
  private get user() {
    return this.purpose === 'preview' ? 'r2-preview' : 'r2-agent';
  }
  readonly setup;
  constructor(
    private sandbox: Sandbox,
    private grant:
      RunGrant | { config: Pick<RunGrant['config'], 'repository' | 'baseSha' | 'executionSetup'> },
    private account: ExecutionCredentials,
    private deadline: number,
    private previous?: { digest: string; headSha: string },
    private purpose: 'implementation' | 'preview' = 'implementation',
  ) {
    this.setup = executionProfile.parse(grant.config.executionSetup?.config);
    if (digest(this.setup) !== grant.config.executionSetup?.digest)
      throw new Error('Repository setup changed.');
  }
  private async run(cmd: string, args: string[], cwd = this.path, limitMs = 180000) {
    const timeout = Math.min(limitMs, this.deadline - Date.now() - 15000);
    if (timeout < 1000) throw new Error('Execution time limit reached.');
    return this.sandbox.currentSession().runCommand({
      cmd: 'runuser',
      args: [
        '-u',
        this.user,
        '--',
        'env',
        `PATH=${sandboxPath}`,
        cmd,
        ...(cmd === 'git' ? ['--no-optional-locks', '-c', `safe.directory=${this.path}`] : []),
        ...args,
      ],
      sudo: true,
      cwd,
      timeoutMs: timeout,
      signal: AbortSignal.timeout(timeout + 5000),
    });
  }
  async prepare() {
    const g = this.grant;
    if (this.purpose === 'preview') {
      const initialized = await this.sandbox.currentSession().runCommand({
        cmd: 'sh',
        args: [
          '-ec',
          'id r2-preview >/dev/null 2>&1 || useradd --create-home --shell /bin/bash r2-preview; install -d -m 755 /vercel/sandbox/r2-previews; rm -rf /vercel/sandbox/r2-previews/source; install -d -m 700 -o r2-preview -g r2-preview /vercel/sandbox/r2-previews/source',
        ],
        sudo: true,
        timeoutMs: 15000,
      });
      if (initialized.exitCode !== 0) throw new Error('Preview checkout could not be prepared.');
    }
    if (!/^[-\w.]+\/[-\w.]+$/.test(g.config.repository) || !/^[a-f0-9]{40}$/.test(g.config.baseSha))
      throw new Error('Invalid repository identity.');
    const repo = await fetch(`https://api.github.com/repos/${g.config.repository}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!repo.ok || (await repo.json()).private !== false)
      throw new Error('The pilot currently imports public repositories only.');
    await this.sandbox.updateNetworkPolicy(codexNetworkPolicy(g.config.repository, this.account));
    const existing = await this.sandbox.currentSession().runCommand({
      cmd: 'python3',
      args: [
        '-c',
        `import os
p='${this.path}'
if os.path.islink(p): raise RuntimeError('Invalid checkout')
print('present' if os.path.isdir(p) else 'absent')`,
      ],
      sudo: true,
      timeoutMs: 10000,
    });
    if (existing.exitCode !== 0) throw new Error('The existing checkout cannot be reused.');
    const reuse = this.purpose !== 'preview' && (await existing.stdout()).trim() === 'present';
    if (reuse) {
      const head = await this.run('git', ['rev-parse', 'HEAD']);
      const status = await this.run('git', ['status', '--porcelain']);
      if (
        head.exitCode !== 0 ||
        status.exitCode !== 0 ||
        (await head.stdout()).trim() !== (this.previous?.headSha ?? g.config.baseSha) ||
        (await status.stdout()).trim()
      )
        throw new Error('The retained checkout does not match the approved task candidate.');
      const unlocked = await this.sandbox.currentSession().runCommand({
        cmd: 'python3',
        args: [
          '-c',
          `import os,pwd
user=pwd.getpwnam('r2-agent')
for root,dirs,files in os.walk('${this.path}',topdown=False,followlinks=False):
 for path in [os.path.join(root,n) for n in files]+[root]:
  if os.path.islink(path): continue
  mode=os.stat(path).st_mode
  os.chown(path,user.pw_uid,user.pw_gid)
  os.chmod(path,mode|0o200)
`,
        ],
        sudo: true,
        timeoutMs: 15000,
      });
      if (unlocked.exitCode !== 0) throw new Error('The task checkout could not be unlocked.');
    } else {
      for (const args of [
        ['init', this.path],
        [
          '-C',
          this.path,
          'remote',
          'add',
          'origin',
          `https://github.com/${g.config.repository}.git`,
        ],
        [
          '-C',
          this.path,
          '-c',
          'core.hooksPath=/dev/null',
          'fetch',
          '--depth=1',
          'origin',
          g.config.baseSha,
        ],
        ['-C', this.path, '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', 'FETCH_HEAD'],
      ])
        if (
          (
            await this.run(
              'git',
              args,
              this.purpose === 'preview' ? this.path : '/vercel/sandbox/agent',
            )
          ).exitCode !== 0
        )
          throw new Error('Repository preparation failed.');
      if (this.previous) {
        const bytes = await readFile(
          join(resolve('.local/artifacts'), this.previous.digest + '.bundle'),
        );
        if (
          bytes.length > 64 * 1024 ** 2 ||
          createHash('sha256').update(bytes).digest('hex') !== this.previous.digest
        )
          throw new Error('Previous candidate is invalid.');
        await this.sandbox
          .currentSession()
          .writeFiles([{ path: '/tmp/r2cloud-previous.bundle', content: bytes }]);
        for (const args of [
          [
            '-c',
            'core.hooksPath=/dev/null',
            'fetch',
            '/tmp/r2cloud-previous.bundle',
            this.previous.headSha,
          ],
          ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', this.previous.headSha],
        ])
          if ((await this.run('git', args)).exitCode !== 0)
            throw new Error('Previous candidate could not be restored.');
      }
    }
    const runtime = await this.sandbox.currentSession().runCommand({
      cmd: 'sh',
      args: ['-c', 'if [ -x /opt/r2cloud/bin/bun ]; then /opt/r2cloud/bin/bun --version; fi'],
      timeoutMs: 10000,
    });
    if (runtime.exitCode !== 0 || (await runtime.stdout()).trim() !== '1.4.2') {
      await this.sandbox
        .currentSession()
        .writeFiles([{ path: '/tmp/r2cloud-install-bun.py', content: installBun, mode: 0o600 }]);
      if (
        (
          await this.sandbox.currentSession().runCommand({
            cmd: 'python3',
            args: ['/tmp/r2cloud-install-bun.py'],
            sudo: true,
            timeoutMs: 90000,
          })
        ).exitCode !== 0
      )
        throw new Error('Bun setup failed.');
    }
    const installDirectory = this.setup.install.directory ?? this.setup.directory;
    const installed = await this.run(
      this.setup.install.cmd,
      this.setup.install.args,
      installDirectory === '.' ? this.path : `${this.path}/${installDirectory}`,
    );
    if (installed.exitCode !== 0)
      throw new Error(
        `Dependency installation failed. ${(await installed.stderr()).slice(-4000)}`.trim(),
      );
    return {
      checkout: this.path,
      cwd: this.cwd,
      ...('taskId' in g ? { taskId: g.taskId, generation: g.generation } : {}),
    };
  }
  private get cwd() {
    return this.setup.directory === '.' ? this.path : `${this.path}/${this.setup.directory}`;
  }
  private recoveryTree: string | undefined;
  private recoveryResult: Omit<RunResult, 'stopProof'> | undefined;
  async checkpoint() {
    return this.capture(
      'Edits saved before interruption. Review and rerun checks before publication.',
      true,
      true,
    );
  }
  async candidate(summary: string, interrupted = false) {
    return this.capture(summary, interrupted);
  }
  private async capture(
    summary: string,
    interrupted = false,
    recovery = false,
  ): Promise<Omit<RunResult, 'stopProof'> | undefined> {
    if (this.purpose === 'preview' || !('runId' in this.grant))
      throw new Error('Preview checkouts cannot export candidates.');
    const checks: { name: string; exitCode: number }[] = [];
    let headSha: string;
    let tree: string | undefined;
    if (recovery) {
      const captured = await this.run(
        'bun',
        [
          '-e',
          recoveryScript,
          '--',
          JSON.stringify({
            runId: this.grant.runId,
            baseSha: this.grant.config.baseSha,
            previous: !!this.previous,
            tree: this.recoveryTree,
          }),
        ],
        this.path,
        25000,
      );
      if (captured.exitCode !== 0) throw new Error('Recovery snapshot export failed.');
      const snapshot = JSON.parse(await captured.stdout()) as { tree?: string; headSha?: string };
      if (!snapshot.headSha) return this.recoveryResult;
      tree = snapshot.tree;
      headSha = snapshot.headSha;
      if (!tree || !/^[a-f0-9]{40}$/.test(tree) || !/^[a-f0-9]{40}$/.test(headSha))
        throw new Error('Recovery snapshot identity is invalid.');
    } else {
      const status = await this.run('git', ['status', '--porcelain']);
      const currentHead = await this.run('git', ['rev-parse', 'HEAD']);
      if (status.exitCode !== 0 || currentHead.exitCode !== 0)
        throw new Error('Checkout state could not be read.');
      const head = (await currentHead.stdout()).trim();
      if (
        !(await status.stdout()).trim() &&
        head === this.grant.config.baseSha &&
        !this.previous &&
        !this.recoveryTree
      )
        return;
      for (const test of interrupted ? [] : this.setup.tests)
        checks.push({
          name: [test.cmd, ...test.args].join(' '),
          exitCode: (await this.run(test.cmd, test.args, this.cwd)).exitCode,
        });

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
          `Task ${this.grant.taskId}`,
        ],
        [
          '-c',
          'core.hooksPath=/dev/null',
          'bundle',
          'create',
          '/tmp/r2cloud-candidate.bundle',
          'HEAD',
          `^${this.grant.config.baseSha}`,
        ],
      ])
        if ((await this.run('git', args)).exitCode !== 0)
          throw new Error('Candidate export failed.');
      headSha = (await (await this.run('git', ['rev-parse', 'HEAD'])).stdout()).trim();
      if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Invalid candidate commit.');
    }
    const root = resolve('.local/artifacts');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < 21 * 1024 ** 3)
      throw new Error('Artifact storage requires 21 GiB free.');
    const stream = await this.sandbox
      .currentSession()
      .readFile({ path: '/tmp/r2cloud-candidate.bundle' }, { signal: AbortSignal.timeout(30000) });
    if (!stream) throw new Error('Candidate artifact is missing.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 64 * 1024 ** 2) throw new Error('Candidate exceeds the pilot artifact limit.');
      chunks.push(bytes);
    }
    const artifact = Buffer.concat(chunks);
    const artifactDigest = createHash('sha256').update(artifact).digest('hex');
    const temp = join(root, this.grant.runId + '-' + randomUUID() + '.partial');
    try {
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(artifact);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, join(root, artifactDigest + '.bundle'));
      const directory = await open(root, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temp, { force: true });
    }
    const g = this.grant;
    const result: Omit<RunResult, 'stopProof'> = {
      manifest: {
        orgId: g.orgId,
        projectId: g.projectId,
        taskId: g.taskId,
        runId: g.runId,
        generation: g.generation,
        repository: g.config.repository,
        targetRef: g.config.targetRef,
        branch: `r2cloud/task-${g.taskId}`,
        baseSha: g.config.baseSha,
        headSha,
        artifactDigest,
        summary: summary.slice(0, 4000),
        limitations: ['Product acceptance requires human verification.'],
        fixture: false,
      },
      evidence: {
        validation: checks.map((check) => ({ command: check.name, exitCode: check.exitCode })),
        checks: g.criteria.map((name) => ({
          name,
          status:
            interrupted || checks.some((c) => c.exitCode !== 0)
              ? ('failed' as const)
              : ('unknown' as const),
        })),
        snapshotDigest: artifactDigest,
        preview: { available: false, fixture: false },
      },
    };
    if (recovery) {
      this.recoveryTree = tree;
      this.recoveryResult = result;
    }
    return result;
  }
}
