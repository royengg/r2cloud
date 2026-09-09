import { Router } from 'express';
import { z } from 'zod';
import { readReview } from '@r2cloud/core/review';
export function reviewRoutes() {
  const router = Router();
  router.get('/projects/:projectId/review', async (req, res) => {
    const input = z
      .object({
        thread: z.string().max(100).optional(),
        snapshot: z.string().max(100).optional(),
        file: z.string().max(2000).optional(),
        commit: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .optional(),
      })
      .strict()
      .refine((value) => value.snapshot || (!value.file && !value.commit))
      .parse(req.query);
    res.json(await readReview(res.locals.actor, String(req.params.projectId), input));
  });
  return router;
}
