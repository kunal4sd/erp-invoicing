import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { ValidationError, NotFoundError } from '../../shared/errors';

export async function getJournalEntriesHandler(req: Request, res: Response): Promise<void> {
  const invoiceId = req.query.invoice as string | undefined;
  const referenceId = req.query.reference as string | undefined;
  const entityId = req.query.entityId as string | undefined;

  const entries = await prisma.journalEntry.findMany({
    where: {
      tenantId: req.tenantId,
      ...(invoiceId && { invoiceId }),
      ...(referenceId && { referenceId }),
      ...(entityId && { entityId }),
    },
    include: {
      lines: {
        include: { glAccount: { select: { code: true, name: true, type: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: entries });
}

export async function getJournalEntryHandler(req: Request, res: Response): Promise<void> {
  const entry = await prisma.journalEntry.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenantId },
    include: {
      lines: {
        include: { glAccount: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  if (!entry) throw new NotFoundError('Journal Entry', req.params['id'] as string);
  res.json({ success: true, data: entry });
}

const CreateGLAccountSchema = z.object({
  entityId: z.string().min(1),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  subtype: z.string().optional(),
  currency: z.string().length(3).optional(),
});

export async function createGLAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = CreateGLAccountSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const { entityId, code, name, type, subtype, currency } = parsed.data;

  const existing = await prisma.gLAccount.findFirst({
    where: { tenantId: req.tenantId, entityId, code },
  });
  if (existing) throw new ValidationError(`GL Account code '${code}' already exists`);

  const account = await prisma.gLAccount.create({
    data: {
      tenantId: req.tenantId,
      entityId,
      code,
      name,
      type,
      subtype,
      currency: currency ?? 'USD',
    },
  });

  res.status(201).json({ success: true, data: account });
}

export async function listGLAccountsHandler(req: Request, res: Response): Promise<void> {
  const accounts = await prisma.gLAccount.findMany({
    where: {
      tenantId: req.tenantId,
      ...(req.query.entityId && { entityId: req.query.entityId as string }),
      ...(req.query.type && { type: req.query.type as any }),
      ...(req.query.subtype && { subtype: req.query.subtype as string }),
      isActive: true,
    },
    orderBy: { code: 'asc' },
  });
  res.json({ success: true, data: accounts });
}
