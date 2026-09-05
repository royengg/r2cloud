import type { IncomingHttpHeaders } from 'node:http';
import type { AppOptions } from '../config/options';
import { pool } from '@r2cloud/database';
import { hash } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
export function sessionToken(cookie: string | undefined) {
  return (
    cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('r2session='))
      ?.slice(10) ?? ''
  );
}
export async function authenticate(cookie: string | undefined): Promise<Actor> {
  const user = (
    await pool.query(
      'SELECT u.id,u.kind FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [hash(sessionToken(cookie))],
    )
  ).rows[0];
  requireThat(user, 401, 'Sign in to your workspace.');
  return user;
}
export function requestActor(options: AppOptions, headers: IncomingHttpHeaders) {
  if (options.identity) return options.identity.authenticate(headers);
  requireThat(options.fixture, 401, 'Sign in with GitHub to continue.');
  return authenticate(headers.cookie);
}
