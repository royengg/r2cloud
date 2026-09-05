import { Router } from 'express';
import { createProject } from '@r2cloud/core/projects';
import { createWorkspace } from '@r2cloud/core/onboarding';
export function workspacesRoutes() {
  const router = Router();
  router.post('/workspaces', async (req, res) => {
    res
      .status(201)
      .json(await createWorkspace(res.locals.actor, req.get('Idempotency-Key') ?? '', req.body));
  });
  router.post('/workspaces/:orgId/projects', async (req, res) => {
    res
      .status(201)
      .json(
        await createProject(
          res.locals.actor,
          String(req.params.orgId),
          req.get('Idempotency-Key') ?? '',
          req.body,
        ),
      );
  });
  return router;
}
