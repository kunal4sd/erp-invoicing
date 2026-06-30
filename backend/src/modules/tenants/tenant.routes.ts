import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { z } from 'zod';
import { ValidationError, ConflictError, NotFoundError } from '../../shared/errors';

export const tenantRouter = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY ?? 'demo-admin-key';
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== expected) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid X-Admin-Key header' } });
    return;
  }
  next();
}

const CreateTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  baseCurrency: z.string().length(3).optional(),
});

tenantRouter.post('/', requireAdminKey, async (req, res) => {
  const parsed = CreateTenantSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const existing = await prisma.tenant.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) throw new ConflictError(`Tenant slug '${parsed.data.slug}' already exists`);

  const tenant = await prisma.tenant.create({ data: parsed.data });
  res.status(201).json({ success: true, data: tenant });
});

tenantRouter.get('/', async (_req, res) => {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
  res.json({ success: true, data: tenants });
});

tenantRouter.get('/:id', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) throw new NotFoundError('Tenant', req.params['id'] as string);
  res.json({ success: true, data: tenant });
});
