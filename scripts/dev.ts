import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
// Development processes only. Never provision services or bind a public interface.
const fixture = process.env.R2_MODE === 'fixture';
const commands = [
  ['apps/api/src/main.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
  ...(process.env.R2_GITHUB_APP_CLIENT_SECRET || existsSync('.env.broker')
    ? [['apps/api/src/connection-worker-main.ts']]
    : []),
  ...(fixture
    ? [
        ['apps/api/src/worker-main.ts'],
        ['apps/api/src/publisher-main.ts'],
        ['apps/api/src/preview-main.ts'],
      ]
    : []),
];
const children = commands.map((args) => {
  const env: NodeJS.ProcessEnv = { ...process.env, R2_MODE: fixture ? 'fixture' : 'product' };
  if (args[0] !== 'apps/api/src/connection-worker-main.ts') delete env.R2_GITHUB_APP_CLIENT_SECRET;
  const brokerFile =
    args[0] === 'apps/api/src/connection-worker-main.ts' && existsSync('.env.broker')
      ? ['--env-file=.env.broker']
      : [];
  return spawn(process.execPath, ['--no-env-file', ...brokerFile, ...args], {
    stdio: 'inherit',
    env,
  });
});
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const [index, c] of children.entries())
  c.on('exit', (code) => {
    if (!closing && commands[index]?.[0] === 'apps/api/src/preview-main.ts') {
      console.error(
        'Fixture preview stopped. The board remains available; restart the preview separately.',
      );
      return;
    }
    if (!closing) {
      console.error('A development process stopped:', code);
      stop();
      process.exitCode = code || 1;
    }
  });
