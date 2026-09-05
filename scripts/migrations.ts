import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
/** Apply source-controlled migrations only to a caller-owned disposable test schema. */
export async function applyTestMigrations(db: { query: (sql: string) => Promise<unknown> }) {
  const root = resolve('packages/database/prisma/migrations');
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await db.query(await readFile(resolve(root, entry.name, 'migration.sql'), 'utf8'));
}
