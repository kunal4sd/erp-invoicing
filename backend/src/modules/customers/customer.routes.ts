import { Router } from 'express';
import {
  createCustomerHandler,
  listCustomersHandler,
  getCustomerHandler,
  getAgingHandler,
} from './customer.controller';
import { requireRole } from '../../middleware/requireRole';

export const customerRouter = Router();

customerRouter.get('/', listCustomersHandler);
customerRouter.post('/', requireRole('AR_CLERK'), createCustomerHandler);
customerRouter.get('/:id', getCustomerHandler);
customerRouter.get('/:id/aging', getAgingHandler);
