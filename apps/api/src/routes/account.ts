import { Router } from 'express';
import { prisma } from '@r2cloud/database';
import type { AppOptions } from '../config/options';
import { invitationInbox } from '@r2cloud/core/team';
import { projects } from '@r2cloud/core/service';
export function accountRoutes(options: AppOptions) {
  const router = Router();
  router.get('/me', async (_req, res) => {
    const actor = res.locals.actor;
    const [user, invitations, availableProjects] = await Promise.all([
      prisma.users.findUnique({
        where: { id: actor.id },
        select: { id: true, name: true, kind: true },
      }),
      invitationInbox(actor),
      projects(actor),
    ]);
    res.json({
      user,
      invitations,
      projects: availableProjects,
      mode: 'managed',
      authMode: options.identity?.mode ?? 'unconfigured',
    });
  });
  router.post('/logout', async (req, res) => {
    await options.identity!.signOut(req, res);
  });
  return router;
}
