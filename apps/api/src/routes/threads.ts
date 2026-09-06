import { Router } from 'express';
import { readThreads, changeThread } from '@r2cloud/core/threads';
export function threadRoutes() {
  const router = Router();
  router.get('/projects/:projectId/threads', async (req, res) => {
    res.json(await readThreads(res.locals.actor, String(req.params.projectId)));
  });
  router.get('/projects/:projectId/threads/:threadId', async (req, res) => {
    res.json(
      await readThreads(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.threadId),
      ),
    );
  });
  router.post('/projects/:projectId/threads', async (req, res) => {
    res.json(
      await changeThread(
        res.locals.actor,
        String(req.params.projectId),
        null,
        req.get('Idempotency-Key') ?? '',
        req.body,
      ),
    );
  });
  router.post('/projects/:projectId/threads/:threadId', async (req, res) => {
    res.json(
      await changeThread(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.threadId),
        req.get('Idempotency-Key') ?? '',
        req.body,
      ),
    );
  });
  return router;
}
