import { Request, Response } from 'express';
import { z } from 'zod';
import { createCustomer, listCustomers, getCustomerById, getCustomerAgingReport } from './customer.service';
import { ValidationError } from '../../shared/errors';

const CreateCustomerSchema = z.object({
  entityId: z.string().min(1),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  currency: z.string().length(3).optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.number().int().positive().optional(),
  arAccountId: z.string().optional(),
});

export async function createCustomerHandler(req: Request, res: Response): Promise<void> {
  const parsed = CreateCustomerSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));

  const customer = await createCustomer(req.tenantId, parsed.data);
  res.status(201).json({ success: true, data: customer });
}

export async function listCustomersHandler(req: Request, res: Response): Promise<void> {
  const customers = await listCustomers(req.tenantId, req.query.entityId as string | undefined);
  res.json({ success: true, data: customers });
}

export async function getCustomerHandler(req: Request, res: Response): Promise<void> {
  const customer = await getCustomerById(req.tenantId, req.params['id'] as string);
  res.json({ success: true, data: customer });
}

export async function getAgingHandler(req: Request, res: Response): Promise<void> {
  const report = await getCustomerAgingReport(req.tenantId, req.params['id'] as string);
  res.json({ success: true, data: report });
}
