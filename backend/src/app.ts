import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middleware/errorHandler';
import { tenantMiddleware } from './middleware/tenant';
import { roleMiddleware, requireRole } from './middleware/requireRole';
import { prisma } from './config/database';
import { invoiceRouter } from './modules/invoices/invoice.routes';
import { paymentRouter } from './modules/payments/payment.routes';
import { customerRouter } from './modules/customers/customer.routes';
import { glRouter, createGLAccountHandler, listGLAccountsHandler } from './modules/gl/gl.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { tenantRouter } from './modules/tenants/tenant.routes';
import { creditMemoRouter } from './modules/credit-memos/credit-memo.routes';
import { authRouter } from './modules/auth/auth.routes';
import { authMiddleware, requireAuthUnlessHeaderMode } from './middleware/auth';

const app = express();

// Security & infrastructure middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting — financial APIs need strict limits
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    max: 200,
    keyGenerator: (req) => String(req.headers['x-tenant-id'] ?? req.ip ?? 'unknown'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  })
);

// Health check (no auth required)
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable', timestamp: new Date().toISOString() });
  }
});

// Auth + tenant setup (no tenant middleware needed)
app.use('/api/auth', authRouter);
app.use('/api/tenants', tenantRouter);

// Business routes: optional JWT, then tenant + role
app.use('/api', authMiddleware);
app.use('/api', requireAuthUnlessHeaderMode);
app.use('/api', tenantMiddleware);
app.use('/api', roleMiddleware);
app.use('/api/invoices', invoiceRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/customers', customerRouter);
app.use('/api/journal-entries', glRouter);
app.get('/api/gl-accounts', listGLAccountsHandler);
app.post('/api/gl-accounts', requireRole('CONTROLLER'), createGLAccountHandler);
app.use('/api/reports', reportsRouter);
app.use('/api/credit-memos', creditMemoRouter);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Global error handler
app.use(errorHandler);

export { app };
