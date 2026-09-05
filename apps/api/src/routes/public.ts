import { Router } from 'express';
import type { AppOptions } from '../config/options';

export function publicRoutes(options: AppOptions) {
  const router = Router();
  router.get('/auth-config', (_req, res) =>
    res.json({
      mode: options.identity?.mode ?? (options.fixture ? 'fixture' : 'unconfigured'),
      provider: 'github',
      enabled: Boolean(options.identity),
    }),
  );
  return router;
}
