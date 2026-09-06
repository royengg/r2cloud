import { defineConfig, env } from 'prisma/config';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
export default defineConfig({
  schema: 'packages/database/prisma/schema.prisma',
  migrations: { path: 'packages/database/prisma/migrations' },
  datasource: { url: process.env.DIRECT_URL ?? env('DATABASE_URL') },
});
