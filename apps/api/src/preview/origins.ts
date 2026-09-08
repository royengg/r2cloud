import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { requireThat } from '@r2cloud/contracts/domain';
import { previewOrigin } from '@r2cloud/contracts/preview';

const routes = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        origin: z.string().regex(/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/),
        expiresAt: z.number().int().positive(),
      })
      .strict(),
  )
  .max(16);

export function temporaryPreviewOrigins(file: string) {
  async function current() {
    const content = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    requireThat(content.length <= 8192, 503, 'Invalid temporary preview configuration.');
    const entries = routes.parse(JSON.parse(content));
    requireThat(
      new Set(entries.map((entry) => entry.id)).size === entries.length &&
        new Set(entries.map((entry) => entry.origin)).size === entries.length,
      503,
      'Duplicate temporary preview routes.',
    );
    return entries.filter((entry) => entry.expiresAt > Date.now());
  }
  return {
    async forPreview(id: string) {
      const entry = (await current()).find((entry) => entry.id === id);
      requireThat(entry, 503, 'The temporary preview address is starting. Try again shortly.');
      return entry.origin;
    },
    async forHost(host: string) {
      const entry = (await current()).find((entry) => new URL(entry.origin).host === host);
      requireThat(entry, 404, 'Preview not found.');
      return { id: entry.id, origin: entry.origin };
    },
  };
}

export function configuredPreviewOrigin(domain: string | undefined, file: string | undefined) {
  requireThat(!(domain && file), 503, 'Choose one preview address configuration.');
  if (file) return temporaryPreviewOrigins(file).forPreview;
  return async (id: string) => {
    requireThat(domain, 503, 'The preview gateway is not configured.');
    return previewOrigin(domain, id);
  };
}
