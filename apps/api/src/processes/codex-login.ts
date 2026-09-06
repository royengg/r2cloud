import { open } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { prisma } from '@r2cloud/database';
import { connectCodexOne, refreshCodexModels } from '@r2cloud/core/codex-broker';
import { CodexLoginProcess, cleanStoppedLoginHomes } from '@r2cloud/adapters/codex-login';
import { CredentialVault } from '@r2cloud/adapters/credential-vault';
const binary = process.env.R2_CODEX_BINARY ?? '';
if (!isAbsolute(binary))
  throw new Error('Set R2_CODEX_BINARY to a pinned native Codex executable.');
const file = await open(binary, 'r');
try {
  const header = Buffer.alloc(4);
  await file.read(header, 0, 4, 0);
  if (!header.equals(Buffer.from([127, 69, 76, 70])))
    throw new Error('Use the native Linux Codex executable, not a launcher script.');
} finally {
  await file.close();
}
const { stdout } = await promisify(execFile)(binary, ['--version'], { env: {}, timeout: 5000 });
if (stdout.trim() !== 'codex-cli 0.153.2') throw new Error('This broker requires Codex 0.153.2.');
const root = resolve(process.env.R2_CODEX_BROKER_DIR ?? '.local/codex-broker');
const vault = new CredentialVault(join(root, 'vault'), process.env.R2_CODEX_VAULT_KEY ?? '');
await cleanStoppedLoginHomes(join(root, 'sessions'));
const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());
console.log('Personal Codex login broker ready');
let nextModels = 0;
try {
  while (!stop.signal.aborted) {
    try {
      const worked = await connectCodexOne(
        () => CodexLoginProcess.create(binary, join(root, 'sessions')),
        vault,
        stop.signal,
      );
      if (!worked && Date.now() >= nextModels) {
        nextModels = Date.now() + 60000;
        await refreshCodexModels(
          (auth) => CodexLoginProcess.catalogue(binary, join(root, 'sessions'), auth),
          vault,
        );
      }
      if (!worked) await pause(1000, undefined, { signal: stop.signal });
    } catch {
      if (!stop.signal.aborted) {
        console.error('Codex sign-in processing deferred.');
        await pause(2000);
      }
    }
  }
} finally {
  await prisma.$disconnect();
}
