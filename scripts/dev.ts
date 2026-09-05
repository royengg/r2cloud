import { spawn } from 'node:child_process';
// Development processes only. Never provision services or bind a public interface.
const children = [
  ['apps/api/src/main.ts'],
  ['apps/api/src/worker-main.ts'],
  ['apps/api/src/publisher-main.ts'],
  ['apps/api/src/preview-main.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
].map((args) =>
  spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, R2_MODE: 'fixture' } }),
);
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
    if (!closing && index === 3) {
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
