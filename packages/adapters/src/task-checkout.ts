import type { Sandbox } from '@vercel/sandbox';
import type { RunGrant, RunResult } from '@r2cloud/contracts/adapters';
import { executionProfile } from '@r2cloud/contracts/execution';
import { digest } from '@r2cloud/contracts/hash';
import { sandboxPath, installBun } from './sandbox-bun';
import { codexNetworkPolicy } from './codex-network';
import type { ExecutionCredentials } from './vercel-execution';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, statfs, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class TaskCheckout {
  readonly path = '/vercel/sandbox/agent/repository';
  private setup;
  constructor(
    private sandbox: Sandbox,
    private grant: RunGrant,
    private account: ExecutionCredentials,
    private deadline: number,
    private previous?: { digest: string; headSha: string },
  ) {
    this.setup = executionProfile.parse(grant.config.executionSetup?.config);
    if (digest(this.setup) !== grant.config.executionSetup?.digest)
      throw new Error('Repository setup changed.');
  }
  private async run(cmd: string, args: string[], cwd = this.path) {
    const timeout = Math.min(180000, this.deadline - Date.now() - 15000);
    if (timeout < 1000) throw new Error('Execution time limit reached.');
    return this.sandbox.currentSession().runCommand({
      cmd: 'runuser',
      args: [
        '-u',
        'r2-agent',
        '--',
        'env',
        `PATH=${sandboxPath}`,
        cmd,
        ...(cmd === 'git' ? ['-c', `safe.directory=${this.path}`] : []),
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
    const reuse = (await existing.stdout()).trim() === 'present';
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
        if ((await this.run('git', args, '/vercel/sandbox/agent')).exitCode !== 0)
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
          ['-c', 'core.hooksPath=/dev/null', 'fetch', '/tmp/r2cloud-previous.bundle', 'HEAD'],
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
    if ((await this.run(this.setup.install.cmd, this.setup.install.args, this.cwd)).exitCode !== 0)
      throw new Error('Dependency installation failed. Check repository settings.');
    return { checkout: this.path, cwd: this.cwd, taskId: g.taskId, generation: g.generation };
  }
  private get cwd() {
    return this.setup.directory === '.' ? this.path : `${this.path}/${this.setup.directory}`;
  }
  async candidate(
    summary: string,
    interrupted = false,
  ): Promise<Omit<RunResult, 'stopProof'> | undefined> {
    const status = await this.run('git', ['status', '--porcelain']);
    const head = (await (await this.run('git', ['rev-parse', 'HEAD'])).stdout()).trim();
    if (
      !(await status.stdout()).trim() &&
      head === (this.previous?.headSha ?? this.grant.config.baseSha)
    )
      return;
    const checks: { name: string; exitCode: number }[] = [];
    for (const test of interrupted ? [] : this.setup.tests)
      checks.push({
        name: test.cmd,
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
      ],
    ])
      if ((await this.run('git', args)).exitCode !== 0) throw new Error('Candidate export failed.');
    const headSha = (await (await this.run('git', ['rev-parse', 'HEAD'])).stdout()).trim();
    if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Invalid candidate commit.');
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
    const temp = join(root, this.grant.runId + '.partial');
    try {
      await writeFile(temp, artifact, { flag: 'wx', mode: 0o600 });
      await rename(temp, join(root, artifactDigest + '.bundle'));
    } finally {
      await rm(temp, { force: true });
    }
    const g = this.grant;
    return {
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
        limitations: [
          ...checks.map((c) => `${c.name}: exit ${c.exitCode}`),
          'Product acceptance requires human verification.',
        ],
        fixture: false,
      },
      evidence: {
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
  }
}
