import { Request, Response, NextFunction } from 'express';
import { JwtPayload, verifyToken } from '../modules/auth/jwt';
import { UnauthorizedError } from '../shared/errors';

declare global {
  namespace Express {
    interface Request {
      jwtAuth?: JwtPayload;
    }
  }
}

export function allowHeaderAuth(): boolean {
  return process.env.ALLOW_HEADER_AUTH !== 'false';
}

/**
 * If Authorization: Bearer <jwt> is present, verify and attach claims.
 * JWT claims take precedence over X-User-* / X-Tenant-ID headers on protected routes.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next();
  }

  const token = header.slice(7).trim();
  if (!token) return next();

  try {
    req.jwtAuth = verifyToken(token);
  } catch {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

  next();
}

/**
 * Requires a valid JWT unless ALLOW_HEADER_AUTH=true (curl / integration tests).
 */
export function requireAuthUnlessHeaderMode(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.jwtAuth) return next();
  if (allowHeaderAuth()) return next();
  return next(new UnauthorizedError('Authentication required. POST /api/auth/demo-login to obtain a token.'));
}
