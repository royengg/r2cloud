import type { IncomingHttpHeaders } from 'node:http';
import type { AppOptions } from '../config/options';
import { prisma } from '@r2cloud/database';
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
  const session = await prisma.sessions.findFirst({
    where: { token_hash: hash(sessionToken(cookie)), expires_at: { gt: new Date() } },
    include: { users: true },
  });
  requireThat(session, 401, 'Sign in to your workspace.');
  const { id, kind } = session.users;
  requireThat(kind === 'human' || kind === 'agent', 401, 'Invalid session actor.');
  return { id, kind };
}
export function requestActor(options: AppOptions, headers: IncomingHttpHeaders) {
  if (options.identity) return options.identity.authenticate(headers);
  requireThat(options.fixture, 401, 'Sign in with GitHub to continue.');
  return authenticate(headers.cookie);
}
