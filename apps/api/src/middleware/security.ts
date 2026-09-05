import type { RequestHandler } from 'express';
import { Fault } from '@r2cloud/contracts/domain';
import { allowedOrigins, type AppOptions } from '../config/options';
export function security(options: AppOptions): RequestHandler {
  return (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers.origin && !allowedOrigins(options).has(req.headers.origin))
        return next(new Fault(403, 'Request origin is not permitted.'));
      if (!req.is('application/json'))
        return next(new Fault(415, 'Use an application/json request.'));
    }
    next();
  };
}
