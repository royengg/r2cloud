import { Prisma, schema, type DB } from './index';
const namespace = Prisma.raw(`"${schema}"`);
// Prisma 7 has no row-lock API. Keep PostgreSQL locking here; data access uses models.
const tables = {
  organisations: Prisma.sql`organisations`,
  projects: Prisma.sql`projects`,
  repositories: Prisma.sql`repositories`,
  users: Prisma.sql`users`,
  tasks: Prisma.sql`tasks`,
  runs: Prisma.sql`runs`,
  jobs: Prisma.sql`jobs`,
};
export async function lockRow(db: DB, table: keyof typeof tables, id: string) {
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM ${namespace}.${tables[table]} WHERE id=${id} FOR UPDATE`,
  );
}
export async function nextJob(db: DB, kinds: string[]) {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ${namespace}.jobs WHERE kind IN (${Prisma.join(kinds)}) AND available_at<=now()
    AND (state IN ('ready','uncertain') OR (state='processing' AND lease_until<now()))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  `);
  return rows[0]?.id;
}
export async function nextRepositoryConnection(db: DB) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${namespace}.repository_connections WHERE status='queued' AND expires_at>now()
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  `;
  return rows[0]?.id;
}
