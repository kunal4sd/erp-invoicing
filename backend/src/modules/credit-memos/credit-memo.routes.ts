import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole';
import { createCreditMemo, applyCreditMemo, listCreditMemos } from './credit-memo.service';
import { ValidationError } from '../../shared/errors';

export const creditMemoRouter = Router();

const CreateSchema = z.object({
  entityId: z.string().min(1),
  customerId: z.string().min(1),
  originalInvoiceId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  reason: z.string().min(1),
});

const ApplySchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  arAccountId: z.string().min(1),
  revenueAccountId: z.string().min(1),
});

creditMemoRouter.get('/', async (req, res) => {
  const items = await listCreditMemos(req.tenantId, req.query.customerId as string | undefined);
  res.json({ success: true, data: items });
});

creditMemoRouter.post('/', requireRole('CONTROLLER'), async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const cm = await createCreditMemo(req.tenantId, req.userId, req.userName, parsed.data, req.ip);
  res.status(201).json({ success: true, data: cm });
});

creditMemoRouter.post('/:id/apply', requireRole('CONTROLLER'), async (req, res) => {
  const parsed = ApplySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const cm = await applyCreditMemo(req.tenantId, req.params['id'] as string, req.userId, req.userName, parsed.data, req.ip);
  res.json({ success: true, data: cm });
});
