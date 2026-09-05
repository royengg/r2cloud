import express from 'express';
import type { AppOptions } from './config/options';
import { security } from './middleware/security';
import { handleError } from './middleware/error';
import { fixtureRoutes } from './routes/fixture';
import { publicRoutes } from './routes/public';
import { protectedRoutes } from './routes';
export function createApp(options: AppOptions) {
  const app = express();
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  app.disable('x-powered-by');
  options.identity?.mount(app); // Better Auth must receive the unconsumed request stream.
  app.use('/api', publicRoutes(options));
  app.use(express.json({ limit: '64kb' }));
  app.use(security(options));
  if (options.fixture && !options.identity) app.use('/api', fixtureRoutes());
  app.use('/api', protectedRoutes(options));
  app.use(express.static('dist/web', { index: 'index.html' }));
  app.use(handleError);
  return app;
}
