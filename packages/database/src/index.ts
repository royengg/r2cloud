import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
export const schema = process.env.R2_TEST_SCHEMA ?? 'public';
if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, max: 16, connectionTimeoutMillis: 15000 }
  : {
      host: resolve('.local/pgsocket'),
      port: 55439,
      database: 'postgres',
      max: 16,
      options: `-c search_path=${schema}`,
    };
export const prisma = new PrismaClient({
  adapter: new PrismaPg(config, { schema }),
  transactionOptions: { maxWait: 15000, timeout: 15000 },
});
export type DB = {
  query: (sql: string, values?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
};
function checkedSQL(client: Prisma.TransactionClient): DB {
  return {
    async query(sql, values = []) {
      // Only source-controlled SQL strings enter here; values remain bound parameters.
      // Locks, partial unique indexes and policy transactions remain native Postgres.
      if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = await client.$queryRawUnsafe<any[]>(sql, ...values);
        return { rows, rowCount: rows.length };
      }
      const rowCount = await client.$executeRawUnsafe(sql, ...values);
      return { rows: [], rowCount };
    },
  };
}
export const pool = { ...checkedSQL(prisma), end: () => prisma.$disconnect() };
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => fn(checkedSQL(tx)));
}
