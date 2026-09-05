import { Router } from 'express';
import { snapshot, startBatch, createTask, command, addComment } from '@r2cloud/core/service';
import { requireThat, taskInput, commandInput } from '@r2cloud/contracts/domain';
import { issuePreview } from '@r2cloud/core/preview';
export function tasksRoutes() {
  const router = Router();
  router.get('/projects/:projectId/snapshot', async (req, res) => {
    res.json(await snapshot(res.locals.actor, String(req.params.projectId)));
  });
  router.post('/projects/:projectId/batches', async (req, res) => {
    res.json(
      await startBatch(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        req.body,
      ),
    );
  });
  router.post('/projects/:projectId/tasks', async (req, res) => {
    res
      .status(201)
      .json(
        await createTask(
          res.locals.actor,
          String(req.params.projectId),
          req.get('Idempotency-Key') ?? '',
          taskInput.parse(req.body),
        ),
      );
  });
  router.post('/projects/:projectId/tasks/:taskId/commands', async (req, res) => {
    res.json(
      await command(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.taskId),
        req.get('Idempotency-Key') ?? '',
        commandInput.parse(req.body),
      ),
    );
  });
  router.post('/projects/:projectId/comments', async (req, res) => {
    requireThat(
      typeof req.body.body === 'string' &&
        (req.body.taskId === null || typeof req.body.taskId === 'string'),
      400,
      'Message and scope are required.',
    );
    res.json(
      await addComment(
        res.locals.actor,
        String(req.params.projectId),
        req.body.taskId,
        req.get('Idempotency-Key') ?? '',
        req.body.body,
      ),
    );
  });
  router.post('/projects/:projectId/candidates/:candidateId/preview', async (req, res) => {
    res.json(
      await issuePreview(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.candidateId),
      ),
    );
  });
  return router;
}
