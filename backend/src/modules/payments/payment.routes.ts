import { Router } from 'express';
import { recordPaymentHandler, getPaymentHandler } from './payment.controller';
import { requireRole } from '../../middleware/requireRole';

export const paymentRouter = Router();

paymentRouter.post('/', requireRole('AR_CLERK'), recordPaymentHandler);
paymentRouter.get('/:id', getPaymentHandler);
