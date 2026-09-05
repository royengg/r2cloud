import { Router } from 'express';
import { team, invite, revokeInvitation, acceptInvitation, updateMember } from '@r2cloud/core/team';
export function teamRoutes() {
  const router = Router();
  router.get('/projects/:projectId/team', async (req, res) =>
    res.json(await team(res.locals.actor, String(req.params.projectId))),
  );
  router.post('/projects/:projectId/invitations', async (req, res) =>
    res
      .status(201)
      .json(
        await invite(
          res.locals.actor,
          String(req.params.projectId),
          req.get('Idempotency-Key') ?? '',
          req.body,
        ),
      ),
  );
  router.post('/projects/:projectId/invitations/:invitationId/revoke', async (req, res) =>
    res.json(
      await revokeInvitation(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        String(req.params.invitationId),
      ),
    ),
  );
  router.post('/invitations/:invitationId/accept', async (req, res) =>
    res.json(await acceptInvitation(res.locals.actor, String(req.params.invitationId))),
  );
  router.post('/projects/:projectId/members/:userId', async (req, res) =>
    res.json(
      await updateMember(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        String(req.params.userId),
        req.body,
      ),
    ),
  );
  return router;
}
