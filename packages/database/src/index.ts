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
export { Prisma };
export type DB = Prisma.TransactionClient;
export type { tasks, jobs } from '@prisma/client';
/** Serialize domain payloads at the JSON-column boundary, including optional properties. */
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
