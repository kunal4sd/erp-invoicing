import { Router } from 'express';
import { arSummaryHandler, arAgingAllHandler, glReconciliationHandler } from './reports.controller';

export const reportsRouter = Router();

reportsRouter.get('/ar-summary', arSummaryHandler);
reportsRouter.get('/ar-aging', arAgingAllHandler);
reportsRouter.get('/gl-reconciliation', glReconciliationHandler);
