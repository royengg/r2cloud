import { execFileSync } from 'node:child_process';

const config = JSON.parse(process.argv.at(-1)!);
if (!/^[a-zA-Z0-9-]{1,100}$/.test(config.runId) || !/^[a-f0-9]{40}$/.test(config.baseSha))
  throw new Error('Invalid recovery identity.');
const deadline = Date.now() + 20000;
function git(args: string[], index = false) {
  return execFileSync(
    'git',
    [
      '--no-optional-locks',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      `safe.directory=${process.cwd()}`,
      '-c',
      'user.name=R2Cloud Agent',
      '-c',
      'user.email=agent@r2cloud.invalid',
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: Math.max(1, deadline - Date.now()),
      env: { ...process.env, ...(index ? { GIT_INDEX_FILE: '/tmp/r2cloud-recovery.index' } : {}) },
    },
  ).trim();
}
const head = git(['rev-parse', 'HEAD']);
if (
  !git(['status', '--porcelain']) &&
  head === config.baseSha &&
  !config.previous &&
  !config.tree
) {
  process.stdout.write('{}');
} else {
  git(['read-tree', 'HEAD'], true);
  git(['add', '--all'], true);
  const tree = git(['write-tree'], true);
  if (tree === config.tree) process.stdout.write(JSON.stringify({ tree }));
  else {
    const headSha = git(['commit-tree', tree, '-p', head, '-m', `Recovery ${config.runId}`]);
    const ref = `refs/r2cloud/recovery/${config.runId}`;
    git(['update-ref', ref, headSha]);
    git(['bundle', 'create', '/tmp/r2cloud-candidate.bundle', ref, `^${config.baseSha}`]);
    process.stdout.write(JSON.stringify({ tree, headSha }));
  }
}
