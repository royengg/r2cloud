import { Router } from 'express';
import {
  beginCodexConnection,
  codexConnection,
  disconnectCodex,
} from '@r2cloud/core/codex-connections';
export function codexRoutes(available: boolean) {
  const router = Router();
  router.get('/projects/:projectId/codex', async (req, res) =>
    res.json(await codexConnection(res.locals.actor, String(req.params.projectId), available)),
  );
  router.post('/projects/:projectId/codex', async (req, res) =>
    res
      .status(202)
      .json(
        await beginCodexConnection(
          res.locals.actor,
          String(req.params.projectId),
          req.get('Idempotency-Key') ?? '',
          available,
        ),
      ),
  );
  router.post('/projects/:projectId/codex/:connectionId/disconnect', async (req, res) =>
    res.json(
      await disconnectCodex(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.connectionId),
      ),
    ),
  );
  return router;
}
