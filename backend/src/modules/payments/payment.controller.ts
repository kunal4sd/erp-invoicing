import { Request, Response } from 'express';
import { z } from 'zod';
import { recordPayment, getPaymentById } from './payment.service';
import { ValidationError } from '../../shared/errors';

const RecordPaymentSchema = z.object({
  entityId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  paymentDate: z.string().optional(),
  method: z.enum(['CASH', 'CHECK', 'BANK_TRANSFER', 'CREDIT_CARD', 'ACH', 'WIRE']).optional(),
  referenceNumber: z.string().optional(),
  idempotencyKey: z.string().optional(),
  notes: z.string().optional(),
  cashAccountId: z.string().min(1),
  arAccountId: z.string().min(1),
  allocations: z
    .array(z.object({ invoiceId: z.string(), amount: z.number().positive() }))
    .optional(),
});

export async function recordPaymentHandler(req: Request, res: Response): Promise<void> {
  const parsed = RecordPaymentSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const payment = await recordPayment(req.tenantId, req.userId, req.userName, parsed.data, req.ip);
  res.status(201).json({ success: true, data: payment });
}

export async function getPaymentHandler(req: Request, res: Response): Promise<void> {
  const payment = await getPaymentById(req.tenantId, req.params['id'] as string);
  res.json({ success: true, data: payment });
}
