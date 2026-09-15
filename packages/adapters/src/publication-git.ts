import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Fault, requireThat, type CandidateManifest } from '@r2cloud/contracts/domain';
import { SetupRequired, Uncertain } from '@r2cloud/contracts/adapters';

const exec = promisify(execFile);
export async function pushPublicationBundle(
  candidate: CandidateManifest,
  token: string,
  authorize = async () => {},
  previousHead?: string,
) {
  requireThat(
    !candidate.fixture &&
      /^[-\w.]+\/[-\w.]+$/.test(candidate.repository) &&
      /^[a-f0-9]{64}$/.test(candidate.artifactDigest) &&
      [candidate.headSha, candidate.baseSha].every((sha) => /^[a-f0-9]{40}$/.test(sha)) &&
      candidate.branch === `r2cloud/task-${candidate.taskId}` &&
      candidate.branch !== candidate.targetRef,
    409,
    'Invalid publication artifact or branch.',
  );
  requireThat(
    !previousHead || /^[a-f0-9]{40}$/.test(previousHead),
    409,
    'Invalid previous publication commit.',
  );
  const root = resolve('.local/artifacts');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const disk = await statfs(root);
  requireThat(disk.bavail * disk.bsize >= 21 * 1024 ** 3, 507, 'Publication requires 21 GiB free.');
  const bytes = await readFile(join(root, candidate.artifactDigest + '.bundle'));
  requireThat(
    bytes.length <= 64 * 1024 ** 2 &&
      createHash('sha256').update(bytes).digest('hex') === candidate.artifactDigest,
    409,
    'Saved change failed its integrity check.',
  );
  const directory = await mkdtemp(join(root, 'publish-'));
  const url = `https://github.com/${candidate.repository}.git`;
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
    GIT_CONFIG_VALUE_0:
      'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64'),
  };
  const git = async (args: string[]) =>
    (
      await exec(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'credential.helper=',
          '-c',
          'http.followRedirects=false',
          '-c',
          'protocol.ext.allow=never',
          ...args,
        ],
        { cwd: directory, env, timeout: 45000, maxBuffer: 2 * 1024 ** 2 },
      )
    ).stdout;
  try {
    await writeFile(join(directory, 'candidate.bundle'), bytes, { mode: 0o600 });
    await git(['init', '--bare', 'repo']);
    const args = ['--git-dir=' + join(directory, 'repo')];
    await git(['check-ref-format', 'refs/heads/' + candidate.branch]);
    await git(['check-ref-format', 'refs/heads/' + candidate.targetRef]);
    const ref = 'refs/heads/' + candidate.branch;
    const existing = (await git([...args, 'ls-remote', '--heads', url, ref]))
      .trim()
      .split(/\s+/)[0];
    requireThat(
      existing === candidate.headSha || existing === (previousHead ?? ''),
      409,
      'The publication branch contains different changes. It will not be overwritten.',
    );
    if (existing === candidate.headSha) return;
    await git([...args, 'fetch', '--depth=1', '--no-tags', url, candidate.baseSha]);
    await git([
      ...args,
      'fetch',
      '--no-tags',
      join(directory, 'candidate.bundle'),
      candidate.headSha,
    ]);
    const head = (await git([...args, 'rev-parse', candidate.headSha + '^{commit}'])).trim();
    requireThat(head === candidate.headSha, 409, 'Saved change has a different commit.');
    await git([...args, 'merge-base', '--is-ancestor', candidate.baseSha, candidate.headSha]);
    if (previousHead)
      await git([...args, 'merge-base', '--is-ancestor', previousHead, candidate.headSha]);
    await authorize();
    try {
      await git([
        ...args,
        'push',
        '--porcelain',
        `--force-with-lease=${ref}:${previousHead ?? ''}`,
        url,
        candidate.headSha + ':' + ref,
      ]);
    } catch {
      throw new Uncertain('GitHub did not confirm the branch push. Reconcile before retrying.');
    }
  } catch (error) {
    if (error instanceof Fault || error instanceof Uncertain || error instanceof SetupRequired)
      throw error;
    throw new Error('The saved Git change could not be prepared for publication.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
