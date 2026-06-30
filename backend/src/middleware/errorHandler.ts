import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../shared/errors';
import { logger } from '../shared/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Prisma unique-constraint violation — convert to 409 so clients don't see a raw 500.
  // Idempotency races are handled in the service layer first; this is the safety net for
  // any other unique constraint violation (e.g. duplicate customer code).
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const fields = Array.isArray(err.meta?.target)
      ? (err.meta.target as string[]).join(', ')
      : String(err.meta?.target ?? 'unknown field');
    res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: `Duplicate value on ${fields}. If this is a retry, include an idempotency key.` },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code ?? 'APP_ERROR',
        message: err.message,
      },
    });
    return;
  }

  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
