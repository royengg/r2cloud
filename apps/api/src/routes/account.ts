import { Router } from 'express';
import { prisma } from '@r2cloud/database';
import { hash } from '@r2cloud/contracts/hash';
import { sessionToken } from '../auth/session';
import type { AppOptions } from '../config/options';
import { invitationInbox } from '@r2cloud/core/team';
import { projects } from '@r2cloud/core/service';
export function accountRoutes(options: AppOptions) {
  const router = Router();
  router.get('/me', async (_req, res) => {
    const actor = res.locals.actor;
    const user = await prisma.users.findUnique({
      where: { id: actor.id },
      select: { id: true, name: true, kind: true },
    });
    res.json({
      user,
      invitations: await invitationInbox(actor),
      projects: await projects(actor),
      mode: options.fixture ? 'fixture' : 'managed',
      authMode: options.identity?.mode ?? 'fixture',
    });
  });
  router.post('/logout', async (req, res) => {
    if (options.identity) return options.identity.signOut(req, res);
    await prisma.sessions.deleteMany({
      where: { token_hash: hash(sessionToken(req.headers.cookie)) },
    });
    res.clearCookie('r2session');
    res.json({ ok: true });
  });
  return router;
}
