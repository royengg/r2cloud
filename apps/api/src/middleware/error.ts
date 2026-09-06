import type { ErrorRequestHandler } from 'express';
import { Fault } from '@r2cloud/contracts/domain';
import { ZodError } from 'zod';
export const handleError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const malformed = err?.type === 'entity.parse.failed' && err.status === 400;
  const oversized = err?.type === 'entity.too.large' && err.status === 413;
  const status =
    err instanceof Fault
      ? err.status
      : err instanceof ZodError || malformed
        ? 400
        : oversized
          ? 413
          : 500;
  res.status(status).json({
    error:
      status === 500
        ? 'The request could not be completed.'
        : malformed
          ? 'Use a valid JSON request body.'
          : oversized
            ? 'The request body is too large.'
            : err instanceof ZodError
              ? 'Check the required fields and try again.'
              : err.message,
  });
  if (status === 500)
    console.error('API error:', err instanceof Error ? err.message : 'Unknown error');
};
