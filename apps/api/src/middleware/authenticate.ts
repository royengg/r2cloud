import type { RequestHandler } from 'express';
import type { AppOptions } from '../config/options';
import { requestActor } from '../auth/session';
export function authenticateRequest(options: AppOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      res.locals.actor = await requestActor(options, req.headers);
      next();
    } catch (e) {
      if (req.path === '/repository-callback') {
        res.redirect(303, '/?error=repository_session');
        return;
      }
      next(e);
    }
  };
}
