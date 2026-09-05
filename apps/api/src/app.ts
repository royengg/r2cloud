import express from 'express';
import type { AppOptions } from './config/options';
import { security } from './middleware/security';
import { authenticateRequest } from './middleware/authenticate';
import { handleError } from './middleware/error';
import { fixtureRoutes } from './routes/fixture';
import { accountRoutes } from './routes/account';
import { workspacesRoutes } from './routes/workspaces';
import { tasksRoutes } from './routes/tasks';
import { teamRoutes } from './routes/team';
import { connectionRoutes } from './routes/connections';
export function createApp(options: AppOptions) {
  const app = express();
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  app.disable('x-powered-by');
  options.identity?.mount(app); // Better Auth must receive the unconsumed request stream.
  app.get('/api/auth-config', (_req, res) =>
    res.json({
      mode: options.identity?.mode ?? (options.fixture ? 'fixture' : 'unconfigured'),
      provider: 'github',
      enabled: Boolean(options.identity),
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(security(options));
  if (options.fixture && !options.identity) app.use('/api', fixtureRoutes());
  app.use('/api', authenticateRequest(options));
  app.use('/api', teamRoutes());
  app.use('/api', connectionRoutes(options.repositoryConnection));
  app.use('/api', accountRoutes(options));
  app.use('/api', workspacesRoutes());
  app.use('/api', tasksRoutes());
  app.use(express.static('dist/web', { index: 'index.html' }));
  app.use(handleError);
  return app;
}
