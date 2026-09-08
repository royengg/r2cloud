import { Router } from 'express';
import { configuredPreviewOrigin } from '../preview/origins';
import { readLivePreview, issueLivePreview } from '@r2cloud/core/live-preview';
import { readPreviewScreenshot } from '@r2cloud/core/preview-inspection';

export function livePreviewRoutes(domain?: string, routesFile?: string) {
  const originFor = configuredPreviewOrigin(domain, routesFile);
  const router = Router();
  router.get('/projects/:projectId/preview-screenshots/:itemId', async (req, res) => {
    const bytes = await readPreviewScreenshot(
      res.locals.actor,
      String(req.params.projectId),
      String(req.params.itemId),
    );
    res
      .set({
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      .send(bytes);
  });
  router.get('/projects/:projectId/threads/:threadId/preview', async (req, res) => {
    res.json(
      await readLivePreview(
        res.locals.actor,
        String(req.params.projectId),
        String(req.params.threadId),
      ),
    );
  });
  router.post('/projects/:projectId/previews/:previewId/open', async (req, res) => {
    const origin = await originFor(String(req.params.previewId));
    const { ticket } = await issueLivePreview(
      res.locals.actor,
      String(req.params.projectId),
      String(req.params.previewId),
    );
    res.json({ url: origin + '/_r2cloud/open#' + ticket });
  });
  return router;
}
