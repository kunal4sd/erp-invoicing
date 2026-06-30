import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../shared/errors';

// Role hierarchy — higher index = more permissions
const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  AR_CLERK: 1,
  AP_CLERK: 1,
  CONTROLLER: 2,
  ADMIN: 3,
};

declare global {
  namespace Express {
    interface Request {
      userRole: string;
    }
  }
}

/**
 * Extracts user role from X-User-Role header (set by the auth layer in production).
 * For demo purposes this trusts the header directly.
 */
export function roleMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.jwtAuth) {
    req.userRole = req.jwtAuth.role;
  } else {
    req.userRole = (req.headers['x-user-role'] as string) ?? 'VIEWER';
  }
  next();
}

/**
 * Returns Express middleware that enforces a minimum role level.
 * Usage: router.post('/:id/approve', requireRole('CONTROLLER'), handler)
 */
export function requireRole(minRole: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRank = ROLE_RANK[req.userRole] ?? 0;
    const requiredRank = ROLE_RANK[minRole] ?? 99;
    if (userRank < requiredRank) {
      return next(
        new ForbiddenError(
          `Action requires role '${minRole}' or above. Your role: '${req.userRole}'`
        )
      );
    }
    next();
  };
}
