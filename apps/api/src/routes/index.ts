import { Router } from 'express';
import { codexRoutes } from './codex';
import type { AppOptions } from '../config/options';
import { authenticateRequest } from '../middleware/authenticate';
import { accountRoutes } from './account';
import { connectionRoutes } from './connections';
import { tasksRoutes } from './tasks';
import { teamRoutes } from './team';
import { workspacesRoutes } from './workspaces';

export function protectedRoutes(options: AppOptions) {
  const router = Router();
  router.use(authenticateRequest(options));
  router.use(teamRoutes());
  router.use(codexRoutes(options.codexLogin ?? false));
  router.use(connectionRoutes(options.repositoryConnection));
  router.use(accountRoutes(options));
  router.use(workspacesRoutes());
  router.use(tasksRoutes());
  return router;
}
