import { spawn, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  rmSync,
  openSync,
  closeSync,
  readSync,
  fstatSync,
} from 'node:fs';
import { createServer } from 'node:net';
const config = JSON.parse(process.argv.at(-1)!);
const deadline = Date.now() + config.timeout;
const root = '/tmp/r2cloud-preview-control';
mkdirSync(root, { recursive: true, mode: 0o700 });
const state = root + '/preview-process.json';
function birth(pid: number) {
  try {
    return readFileSync('/proc/' + pid + '/stat', 'utf8')
      .split(') ')[1]
      .split(' ')[19];
  } catch {
    return null;
  }
}
function stop() {
  let old: { pid: number; birth: string };
  try {
    old = JSON.parse(readFileSync(state, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (birth(old.pid) === old.birth) {
    try {
      process.kill(-old.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  rmSync(state, { force: true });
}
stop();
if (config.stop) process.exit(0);
const releaseDeadline = Math.min(deadline, Date.now() + 5000);
while (true) {
  try {
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(config.port, '127.0.0.1', () =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
    });
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || Date.now() >= releaseDeadline)
      throw error;
    await Bun.sleep(100);
  }
}
const source = config.independent
  ? '/vercel/sandbox/r2-previews/source'
  : '/vercel/sandbox/agent/repository';
if (lstatSync(source).isSymbolicLink() || realpathSync(source) !== source)
  throw Error('Invalid preview checkout');
let user = config.independent ? 'r2-preview' : 'r2-agent',
  directory = source;
function run(command: string, args: string[]) {
  const timeout = deadline - Date.now();
  if (timeout <= 0) throw Error('Preview preparation timed out');
  return execFileSync(command, args, { timeout });
}
if (config.snapshot) {
  try {
    run('id', ['r2-preview']);
  } catch {
    run('useradd', ['--create-home', '--shell', '/bin/bash', 'r2-preview']);
  }
  const parent = '/vercel/sandbox/r2-previews';
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  directory = parent + '/repository';
  rmSync(directory, { recursive: true, force: true });
  run('cp', ['-a', '--reflink=auto', source, directory]);
  run('chown', ['-hR', 'r2-preview:r2-preview', directory]);
  run('chmod', ['-R', 'u+rwX', directory]);
  user = 'r2-preview';
}
const cwd = config.directory === '.' ? directory : directory + '/' + config.directory;
const resolved = realpathSync(cwd);
if (resolved !== directory && !resolved.startsWith(directory + '/'))
  throw Error('Invalid preview directory');
const logPath = root + '/preview.log';
const log = openSync(logPath, 'w', 0o600);
const child = spawn('runuser', ['-u', user, '--', config.cmd, ...config.args], {
  cwd,
  detached: true,
  stdio: ['ignore', log, log],
  env: {
    PATH: config.path,
    HOME: '/home/' + user,
    USER: user,
    LOGNAME: user,
    LANG: 'C.UTF-8',
    PORT: String(config.port),
    HOST: '127.0.0.1',
  },
});
await new Promise<void>((resolve, reject) => {
  child.once('spawn', resolve);
  child.once('error', reject);
});
closeSync(log);
writeFileSync(state, JSON.stringify({ pid: child.pid, birth: birth(child.pid!) }), { mode: 0o600 });
child.unref();
function failed() {
  stop();
  const file = openSync(logPath, 'r');
  const bytes = Buffer.alloc(Math.min(4000, fstatSync(file).size));
  readSync(file, bytes, 0, bytes.length, Math.max(0, fstatSync(file).size - bytes.length));
  closeSync(file);
  process.stdout.write(bytes);
  process.exit(1);
}
while (Date.now() < deadline) {
  if (!birth(child.pid!)) failed();
  try {
    const response = await fetch('http://127.0.0.1:' + config.port + config.healthPath, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    });
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 400) process.exit(0);
  } catch {}
  await Bun.sleep(300);
}
failed();
