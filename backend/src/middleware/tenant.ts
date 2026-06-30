import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../shared/errors';

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      userId: string;
      userName: string;
    }
  }
}

/**
 * Extracts tenant context from X-Tenant-ID header and validates it exists.
 * In production this would also verify a JWT and extract userId/userName.
 */
export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = req.jwtAuth?.tenantId ?? (req.headers['x-tenant-id'] as string | undefined);

  if (!tenantId) {
    return next(new AppError('X-Tenant-ID header is required', 400, 'MISSING_TENANT'));
  }

  if (req.jwtAuth && req.headers['x-tenant-id'] && req.headers['x-tenant-id'] !== req.jwtAuth.tenantId) {
    return next(new AppError('X-Tenant-ID does not match authenticated user tenant', 403, 'TENANT_MISMATCH'));
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, isActive: true },
  });

  if (!tenant) {
    return next(new AppError(`Tenant '${tenantId}' not found`, 404, 'TENANT_NOT_FOUND'));
  }

  if (!tenant.isActive) {
    return next(new AppError('Tenant is inactive', 403, 'TENANT_INACTIVE'));
  }

  req.tenantId = tenantId;

  if (req.jwtAuth) {
    req.userId = req.jwtAuth.sub;
    req.userName = req.jwtAuth.name;
  } else {
    req.userId = (req.headers['x-user-id'] as string) ?? 'system';
    req.userName = (req.headers['x-user-name'] as string) ?? 'System';
  }

  next();
}
