import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Fault, type CandidateManifest } from '@r2cloud/contracts/domain';
import type { ReviewIndex, ReviewDiff } from '@r2cloud/contracts/review';

const exec = promisify(execFile);
const pending = new Map<string, Promise<ReviewIndex & { diffs: Record<string, ReviewDiff> }>>();
const root = resolve('.local/artifacts');
async function git(directory: string, args: string[], maxBuffer = 2 * 1024 ** 2) {
  return (
    await exec(
      'git',
      [
        '--no-optional-locks',
        '--literal-pathspecs',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'credential.helper=',
        '-c',
        'protocol.ext.allow=never',
        ...args,
      ],
      {
        cwd: directory,
        timeout: 45000,
        maxBuffer,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
    )
  ).stdout;
}
export async function inspectGitReview(
  directory: string,
  base: string,
  head: string,
  commit?: string,
) {
  if (![base, head, ...(commit ? [commit] : [])].every((value) => /^[a-f0-9]{40}$/.test(value)))
    throw new Error('Invalid review revision.');
  const history = await git(directory, [
    'log',
    '-100',
    '--format=%H%x00%an%x00%aI%x00%s',
    `${base}..${head}`,
  ]);
  const commits = history
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split('\0');
      return { sha: sha!, author: author!, date: date!, subject: subject! };
    })
    .filter((commit) => !/^Recovery /.test(commit.subject));
  if (commit && !commits.some((value) => value.sha === commit))
    throw new Error('Commit is not in this saved change.');
  const from = commit ? `${commit}^` : base;
  const to = commit ?? head;
  const stats = await git(directory, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--numstat',
    '-z',
    from,
    to,
  ]);
  const files = stats
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error('Invalid Git file summary.');
      return {
        path: match[3]!,
        added: match[1] === '-' ? null : Number(match[1]),
        removed: match[2] === '-' ? null : Number(match[2]),
      };
    });
  if (files.length > 500) throw new Error('This change exceeds the 500-file review limit.');
  const diffs: Record<string, ReviewDiff> = Object.create(null);
  let size = 0;
  const deadline = Date.now() + 30000;
  for (const file of files) {
    if (Date.now() > deadline)
      throw new Error('Preparing this diff took too long. Try a smaller commit.');
    if (file.added === null || file.added + (file.removed ?? 0) > 4000 || size > 4 * 1024 ** 2) {
      diffs[file.path] = {
        patch: '',
        unavailable:
          file.added === null
            ? 'Binary file. Text diff is unavailable.'
            : 'This file exceeds the inline diff limit.',
      };
      continue;
    }
    try {
      const patch = await git(
        directory,
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--unified=3',
          from,
          to,
          '--',
          file.path,
        ],
        256 * 1024,
      );
      size += Buffer.byteLength(patch);
      diffs[file.path] = { patch, unavailable: null };
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
      diffs[file.path] = { patch: '', unavailable: 'This file exceeds the inline diff limit.' };
    }
  }
  return { files, commits, diffs };
}
export async function savedGitReview(manifest: CandidateManifest, commit?: string) {
  if (
    !/^[a-f0-9]{64}$/.test(manifest.artifactDigest) ||
    !/^[-\w.]+\/[-\w.]+$/.test(manifest.repository) ||
    ![manifest.baseSha, manifest.headSha, ...(commit ? [commit] : [])].every((value) =>
      /^[a-f0-9]{40}$/.test(value),
    )
  )
    throw new Error('Invalid saved change.');
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        manifest.artifactDigest,
        manifest.repository,
        manifest.baseSha,
        manifest.headSha,
        commit,
      ]),
    )
    .digest('hex');
  const cache = join(root, `${key}.review-v1.json`);
  const active = pending.get(key);
  if (active) return active;
  if (pending.size >= 2)
    throw new Fault(503, 'Other saved changes are being prepared. Try again shortly.');
  const operation = (async () => {
    try {
      return JSON.parse(await readFile(cache, 'utf8')) as Awaited<
        ReturnType<typeof inspectGitReview>
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < 21 * 1024 ** 3)
      throw new Error('Review storage requires 21 GiB free.');
    const bundle = join(root, `${manifest.artifactDigest}.bundle`);
    const artifact = await stat(bundle).catch((error) => {
      if (error.code === 'ENOENT')
        throw new Fault(410, 'This saved change is no longer available in artifact storage.');
      throw error;
    });
    if (artifact.size > 64 * 1024 ** 2) throw new Error('Saved change exceeds the artifact limit.');
    if (
      createHash('sha256')
        .update(await readFile(bundle))
        .digest('hex') !== manifest.artifactDigest
    )
      throw new Fault(409, 'Saved change failed its integrity check.');
    const directory = await mkdtemp(join(root, 'review-'));
    const temporary = `${cache}.${randomUUID()}.partial`;
    try {
      await git(directory, ['init', '--bare', '.']);
      await git(directory, [
        'fetch',
        '--depth=1',
        '--no-tags',
        `https://github.com/${manifest.repository}.git`,
        manifest.baseSha,
      ]);
      try {
        await git(directory, ['fetch', '--no-tags', bundle, manifest.headSha]);
      } catch {
        throw new Fault(
          409,
          'This saved change is incomplete or unreadable. Select another revision or ask the agent to prepare a new change.',
        );
      }
      const review = await inspectGitReview(directory, manifest.baseSha, manifest.headSha, commit);
      await writeFile(temporary, JSON.stringify(review), { mode: 0o600, flag: 'wx' });
      await rename(temporary, cache);
      return review;
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(temporary, { force: true });
    }
  })();
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    pending.delete(key);
  }
}
