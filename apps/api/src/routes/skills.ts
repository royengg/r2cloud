import { Router } from 'express';
import { z } from 'zod';
import { readSkills, changeSkill, importSkill } from '@r2cloud/core/skills';

export function skillRoutes() {
  const router = Router();
  router.get('/projects/:projectId/skills', async (req, res) =>
    res.json(await readSkills(res.locals.actor, String(req.params.projectId))),
  );
  router.post('/projects/:projectId/skills', async (req, res) =>
    res.json(
      await changeSkill(
        res.locals.actor,
        String(req.params.projectId),
        req.get('Idempotency-Key') ?? '',
        req.body,
      ),
    ),
  );
  router.post('/projects/:projectId/skills/import', async (req, res) => {
    const { content } = z
      .object({ content: z.string().max(32000) })
      .strict()
      .parse(req.body);
    res.json(await importSkill(res.locals.actor, String(req.params.projectId), content));
  });
  return router;
}
