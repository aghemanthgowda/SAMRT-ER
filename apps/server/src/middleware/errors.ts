import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AuthError } from '../auth/auth.js';
import { DispatchError } from '../services/dispatch.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Endpoint not found.' });
}

/**
 * Single error boundary.
 *
 * Client errors carry their own message because operators need to know what
 * went wrong. Anything unexpected is logged in full server-side and reported
 * generically, so an internal failure never leaks a stack trace to a browser.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'The request body is not valid.',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  if (error instanceof AuthError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof DispatchError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  console.error('[api] unhandled error:', error);
  res.status(500).json({ error: 'An internal error occurred.' });
}

/** Wrap an async handler so a rejected promise reaches the error boundary. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}
