import { readExecutionSetup, saveExecutionSetup } from '@r2cloud/core/execution-setup';
import { Router } from 'express';
import {
  attachRepository,
  beginRepositoryConnection,
  connectionStatus,
  queueRepositoryCallback,
  type ConnectionConfig,
} from '@r2cloud/core/repository-connections';
export function connectionRoutes(config?: ConnectionConfig) {
  const router = Router();
  router.get('/projects/:projectId/execution-setup', async (req, res) =>
    res.json(await readExecutionSetup(res.locals.actor, String(req.params.projectId))),
  );
  router.post('/projects/:projectId/execution-setup', async (req, res) =>
    res.json(
      await saveExecutionSetup(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        req.body,
      ),
    ),
  );
  router.get('/projects/:projectId/connections', async (req, res) =>
    res.json(await connectionStatus(res.locals.actor, String(req.params.projectId), config)),
  );
  router.post('/projects/:projectId/repository-authorization', async (req, res) =>
    res.json(
      await beginRepositoryConnection(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        config,
      ),
    ),
  );
  router.get('/repository-callback', async (req, res) => {
    try {
      const result = await queueRepositoryCallback(
        res.locals.actor,
        String(req.query.state ?? ''),
        String(req.query.code ?? ''),
      );
      res.redirect(303, `/?connections=1&project=${encodeURIComponent(result.projectId)}`);
    } catch {
      res.redirect(303, '/?connections=1&connection_error=failed');
    }
  });
  router.post('/projects/:projectId/repository', async (req, res) =>
    res.json(await attachRepository(res.locals.actor, String(req.params.projectId), req.body)),
  );
  return router;
}
