import { Router } from 'express';
import { requireThat } from '@r2cloud/contracts/domain';
import { previewOrigin } from '@r2cloud/contracts/preview';
import { readLivePreview, issueLivePreview } from '@r2cloud/core/live-preview';
import { readPreviewScreenshot } from '@r2cloud/core/preview-inspection';

export function livePreviewRoutes(domain?: string) {
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
    requireThat(domain, 503, 'The preview gateway is not configured.');
    const origin = previewOrigin(domain, String(req.params.previewId));
    const { ticket } = await issueLivePreview(
      res.locals.actor,
      String(req.params.projectId),
      String(req.params.previewId),
    );
    res.json({ url: origin + '/_r2cloud/open#' + ticket });
  });
  return router;
}
