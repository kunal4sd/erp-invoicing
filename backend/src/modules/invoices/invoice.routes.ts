import { Router } from 'express';
import { requireRole } from '../../middleware/requireRole';
import {
  createInvoiceHandler,
  getInvoiceHandler,
  listInvoicesHandler,
  approveInvoiceHandler,
  voidInvoiceHandler,
  sendInvoiceHandler,
  writeOffInvoiceHandler,
} from './invoice.controller';

export const invoiceRouter = Router();

invoiceRouter.get('/', listInvoicesHandler);
invoiceRouter.post('/', requireRole('AR_CLERK'), createInvoiceHandler);
invoiceRouter.get('/:id', getInvoiceHandler);
invoiceRouter.post('/:id/approve', requireRole('CONTROLLER'), approveInvoiceHandler);
invoiceRouter.post('/:id/send', requireRole('AR_CLERK'), sendInvoiceHandler);
invoiceRouter.post('/:id/void', requireRole('CONTROLLER'), voidInvoiceHandler);
invoiceRouter.post('/:id/write-off', requireRole('CONTROLLER'), writeOffInvoiceHandler);
