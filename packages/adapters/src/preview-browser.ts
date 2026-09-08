import { previewInspection } from '@r2cloud/contracts/preview-inspection';
import { readFileSync } from 'node:fs';
import type { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import { sandboxPath } from './sandbox-bun';

const resultSchema = z.object({
  path: z.string().max(2000),
  status: z.number().int().optional(),
  snapshot: z.string().max(32000),
  errors: z.array(z.string().max(1000)).max(20),
  screenshot: z.string().max(700000),
});
const page = readFileSync(new URL('./preview-browser-page.ts', import.meta.url), 'utf8');
const relay = readFileSync(new URL('./preview-browser-relay.ts', import.meta.url), 'utf8');
export async function inspectPreview(sandbox: Sandbox, port: number, input: unknown) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port.');
  const config = { ...previewInspection.parse(input), port, page };
  const result = await sandbox.currentSession().runCommand({
    cmd: 'env',
    args: ['PATH=' + sandboxPath, 'bun', '-e', relay, '--', JSON.stringify(config)],
    sudo: true,
    timeoutMs: 40000,
    signal: AbortSignal.timeout(45000),
  });
  if (result.exitCode !== 0)
    throw Error('Preview inspection failed. Check browser setup and dev server readiness.');
  const output = await result.stdout();
  if (output.length > 3 * 1024 * 1024) throw Error('Preview inspection exceeded the size limit.');
  const inspection = resultSchema.parse(JSON.parse(output));
  const image = Buffer.from(inspection.screenshot, 'base64');
  if (
    image.length > 512 * 1024 ||
    image.toString('base64') !== inspection.screenshot ||
    image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  )
    throw Error('Preview returned an invalid screenshot.');
  return inspection;
}
