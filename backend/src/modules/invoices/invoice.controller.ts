import { Request, Response } from 'express';
import { z } from 'zod';
import {
  createInvoice,
  getInvoiceById,
  listInvoices,
  approveInvoice,
  voidInvoice,
  markInvoiceSent,
  writeOffInvoice,
} from './invoice.service';
import { ValidationError } from '../../shared/errors';

const LineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(1).optional().default(0),
  glAccountId: z.string().optional(),
});

const CreateInvoiceSchema = z.object({
  entityId: z.string().min(1),
  customerId: z.string().min(1),
  dueDate: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid dueDate' }),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  lineItems: z.array(LineItemSchema).min(1, 'At least one line item required'),
});

const ApproveSchema = z.object({
  arAccountId: z.string().min(1),
  approvedBy: z.string().optional(),
});

export async function createInvoiceHandler(req: Request, res: Response): Promise<void> {
  const parsed = CreateInvoiceSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const invoice = await createInvoice(req.tenantId, req.userId, req.userName, parsed.data, req.ip);
  res.status(201).json({ success: true, data: invoice });
}

export async function getInvoiceHandler(req: Request, res: Response): Promise<void> {
  const invoice = await getInvoiceById(req.tenantId, req.params['id'] as string);
  res.json({ success: true, data: invoice });
}

export async function listInvoicesHandler(req: Request, res: Response): Promise<void> {
  const result = await listInvoices(req.tenantId, {
    entityId: req.query.entityId as string | undefined,
    customerId: req.query.customerId as string | undefined,
    status: req.query.status as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
  });
  res.json({ success: true, ...result });
}

export async function approveInvoiceHandler(req: Request, res: Response): Promise<void> {
  const parsed = ApproveSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const result = await approveInvoice(req.tenantId, req.params['id'] as string, req.userId, req.userName, parsed.data, req.ip);
  res.json({ success: true, data: result });
}

export async function voidInvoiceHandler(req: Request, res: Response): Promise<void> {
  await voidInvoice(req.tenantId, req.params['id'] as string, req.userId, req.userName, req.ip);
  res.json({ success: true, message: 'Invoice voided' });
}

export async function sendInvoiceHandler(req: Request, res: Response): Promise<void> {
  const invoice = await markInvoiceSent(req.tenantId, req.params['id'] as string, req.userId, req.userName, req.ip);
  res.json({ success: true, data: invoice });
}

const WriteOffSchema = z.object({
  badDebtAccountId: z.string().min(1, 'badDebtAccountId is required'),
});

export async function writeOffInvoiceHandler(req: Request, res: Response): Promise<void> {
  const parsed = WriteOffSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  await writeOffInvoice(req.tenantId, req.params['id'] as string, req.userId, req.userName, parsed.data.badDebtAccountId, req.ip);
  res.json({ success: true, message: 'Invoice written off' });
}
