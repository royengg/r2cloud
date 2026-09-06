import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
export const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
const config = { connectionString, max: 16, connectionTimeoutMillis: 15000 };
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
