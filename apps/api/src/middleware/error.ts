import type { ErrorRequestHandler } from 'express';
import { Fault } from '@r2cloud/contracts/domain';
import { ZodError } from 'zod';
export const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof Fault ? err.status : err instanceof ZodError ? 400 : 500;
  res.status(status).json({
    error:
      status === 500
        ? 'The request could not be completed.'
        : err instanceof ZodError
          ? 'Check the required fields and try again.'
          : err.message,
  });
  if (status === 500) console.error('API error:', err.message);
};
