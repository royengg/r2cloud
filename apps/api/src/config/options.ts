import type { ProductIdentity } from '../auth/identity';
import type { ConnectionConfig } from '@r2cloud/core/repository-connections';
const origins = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4310',
  'http://localhost:5173',
  'http://localhost:4310',
]);
if (process.env.R2_DEV_ORIGIN) {
  const origin = new URL(process.env.R2_DEV_ORIGIN);
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('R2_DEV_ORIGIN must be an HTTPS origin.');
  origins.add(origin.origin);
}
export type AppOptions = {
  fixture: boolean;
  identity?: ProductIdentity;
  repositoryConnection?: ConnectionConfig;
};
export function allowedOrigins(options: AppOptions) {
  return options.identity ? new Set([options.identity.origin]) : origins;
}
