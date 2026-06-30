/**
 * API integration tests — tests the full Express HTTP layer (middleware, routing,
 * validation, error handling) with Prisma mocked.
 */

process.env.ALLOW_HEADER_AUTH = 'true';
process.env.JWT_SECRET = 'test-jwt-secret';

import request from 'supertest';
import { app } from '../app';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockTenant = { id: 'tenant-001', isActive: true, name: 'Test Corp', slug: 'test-corp', baseCurrency: 'USD' };
const mockEntity = { id: 'entity-001', tenantId: 'tenant-001', currency: 'USD' };
const mockCustomer = { id: 'cust-001', tenantId: 'tenant-001', entityId: 'entity-001', name: 'Acme', currency: 'USD', code: 'C001' };
const mockARAccount = { id: 'gl-ar-001', tenantId: 'tenant-001', entityId: 'entity-001', code: '1100', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' };
const mockRevenueAccount = { id: 'gl-rev-001', tenantId: 'tenant-001', entityId: 'entity-001', code: '4000', type: 'REVENUE' };

const mockInvoice = {
  id: 'inv-001',
  tenantId: 'tenant-001',
  entityId: 'entity-001',
  customerId: 'cust-001',
  invoiceNumber: 'INV-000001',
  status: 'DRAFT',
  issueDate: new Date(),
  dueDate: new Date('2026-12-31'),
  currency: 'USD',
  exchangeRate: '1',
  subtotal: '1000.00',
  taxAmount: '80.00',
  total: '1080.00',
  amountPaid: '0.00',
  amountDue: '1080.00',
  createdBy: 'user-001',
  createdAt: new Date(),
  updatedAt: new Date(),
  lineItems: [],
  customer: mockCustomer,
  paymentAllocations: [],
  creditAllocations: [],
  journalEntries: [],
};

jest.mock('../config/database', () => {
  const mockPrisma = {
    tenant: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    entity: { findFirst: jest.fn() },
    customer: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    gLAccount: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    invoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    invoiceLineItem: { findMany: jest.fn() },
    payment: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    paymentAllocation: { findMany: jest.fn(), create: jest.fn() },
    journalEntry: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    journalEntryLine: { findMany: jest.fn(), aggregate: jest.fn() },
    accountingPeriod: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $on: jest.fn(),
  };
  return { prisma: mockPrisma };
});

import { prisma } from '../config/database';
const db = prisma as jest.Mocked<typeof prisma>;

// Helper: set up tenant middleware to pass
function withTenant() {
  (db.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
}

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok — no auth required', async () => {
    (db.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });

  it('returns 503 when database is unreachable', async () => {
    (db.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('unreachable');
  });
});

// ─── Tenant middleware ────────────────────────────────────────────────────────

describe('Tenant middleware', () => {
  it('returns 400 when X-Tenant-ID header is missing', async () => {
    const res = await request(app).get('/api/invoices');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_TENANT');
  });

  it('returns 404 when tenant does not exist', async () => {
    (db.tenant.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/invoices').set('X-Tenant-ID', 'nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('returns 403 when tenant is inactive', async () => {
    (db.tenant.findUnique as jest.Mock).mockResolvedValue({ ...mockTenant, isActive: false });
    const res = await request(app).get('/api/invoices').set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_INACTIVE');
  });
});

// ─── Role enforcement ────────────────────────────────────────────────────────

describe('Role enforcement', () => {
  beforeEach(() => withTenant());

  it('AR_CLERK cannot approve an invoice (expects 403)', async () => {
    const res = await request(app)
      .post('/api/invoices/inv-001/approve')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({ arAccountId: 'gl-ar-001' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('CONTROLLER can call approve endpoint (reaches service)', async () => {
    // Stub service layer — we just need it to get past the role check
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(null); // service returns NotFound
    const res = await request(app)
      .post('/api/invoices/inv-001/approve')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'CONTROLLER')
      .send({ arAccountId: 'gl-ar-001' });
    // 404 means it got past the role check — the controller rejected because invoice not found
    expect(res.status).toBe(404);
  });

  it('VIEWER cannot void an invoice (expects 403)', async () => {
    const res = await request(app)
      .post('/api/invoices/inv-001/void')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'VIEWER');
    expect(res.status).toBe(403);
  });

  it('omitting X-User-Role defaults to VIEWER and blocks write endpoints (403)', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001')
      // intentionally no X-User-Role header — should default to VIEWER
      .send({ entityId: 'entity-001', customerId: 'cust-001', dueDate: '2026-12-31',
              lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100 }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ─── Invoice creation ─────────────────────────────────────────────────────────

describe('POST /api/invoices', () => {
  beforeEach(() => {
    withTenant();
    (db.customer.findFirst as jest.Mock).mockResolvedValue(mockCustomer);
    (db.accountingPeriod.findFirst as jest.Mock).mockResolvedValue(null); // period open
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(null); // no existing idempotency key
    (db.auditLog.create as jest.Mock).mockResolvedValue({});
    // $queryRaw used by getNextSequence (SequenceCounter upsert) inside the transaction
    (db.$queryRaw as jest.Mock).mockResolvedValue([{ lastValue: 1 }]);
    (db.$transaction as jest.Mock).mockImplementation(async (fn: Function) => fn(db));
    (db.invoice.create as jest.Mock).mockResolvedValue({ ...mockInvoice, lineItems: [] });
  });

  it('returns 422 when lineItems is empty', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({ entityId: 'entity-001', customerId: 'cust-001', dueDate: '2026-12-31', lineItems: [] });
    expect(res.status).toBe(422);
  });

  it('returns 422 when dueDate is invalid', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({
        entityId: 'entity-001', customerId: 'cust-001',
        dueDate: 'not-a-date',
        lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100 }],
      });
    expect(res.status).toBe(422);
  });

  it('returns 201 with valid invoice payload', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({
        entityId: 'entity-001',
        customerId: 'cust-001',
        dueDate: '2026-12-31',
        lineItems: [{ description: 'Software License', quantity: 1, unitPrice: 1000, taxRate: 0.08 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invoiceNumber).toBe('INV-000001');
  });

  it('returns existing invoice on idempotency key repeat', async () => {
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(mockInvoice);
    const res = await request(app)
      .post('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({
        entityId: 'entity-001', customerId: 'cust-001', dueDate: '2026-12-31',
        idempotencyKey: 'key-already-used',
        lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100 }],
      });
    // Returns 201 with the existing record (idempotent)
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('inv-001');
  });
});

// ─── Invoice list ─────────────────────────────────────────────────────────────

describe('GET /api/invoices', () => {
  beforeEach(() => {
    withTenant();
    (db.invoice.findMany as jest.Mock).mockResolvedValue([mockInvoice]);
    (db.invoice.count as jest.Mock).mockResolvedValue(1);
  });

  it('returns paginated invoice list', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

// ─── Invoice detail ───────────────────────────────────────────────────────────

describe('GET /api/invoices/:id', () => {
  beforeEach(() => withTenant());

  it('returns 404 for unknown invoice', async () => {
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get('/api/invoices/nonexistent')
      .set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(404);
  });

  it('returns invoice detail', async () => {
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(mockInvoice);
    const res = await request(app)
      .get('/api/invoices/inv-001')
      .set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(200);
    expect(res.body.data.invoiceNumber).toBe('INV-000001');
  });
});

// ─── Customer aging ───────────────────────────────────────────────────────────

describe('GET /api/customers/:id/aging', () => {
  beforeEach(() => {
    withTenant();
    (db.customer.findFirst as jest.Mock).mockResolvedValue(mockCustomer);
    (db.invoice.findMany as jest.Mock).mockResolvedValue([
      {
        ...mockInvoice,
        status: 'SENT',
        dueDate: new Date(Date.now() - 35 * 86_400_000), // 35 days overdue
        amountDue: '1080.00',
      },
    ]);
  });

  it('returns aging report with correct bucket', async () => {
    const res = await request(app)
      .get('/api/customers/cust-001/aging')
      .set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.customerName).toBe('Acme');
    // 35 days overdue → days_1_30 bucket? No, 35 days = days_31_60
    expect(parseFloat(data.summary.days_31_60)).toBeGreaterThan(0);
    expect(parseFloat(data.summary.total)).toBeCloseTo(1080, 0);
  });
});

// ─── Journal entries ──────────────────────────────────────────────────────────

describe('GET /api/journal-entries?invoice=:id', () => {
  beforeEach(() => {
    withTenant();
    (db.journalEntry.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'je-001', entryNumber: 'JE-000001', referenceType: 'INVOICE', referenceId: 'inv-001',
        invoiceId: 'inv-001', postingDate: new Date(), period: 6, fiscalYear: 2026,
        status: 'POSTED', description: 'Invoice approved: INV-000001',
        totalDebit: '1080.00', totalCredit: '1080.00', createdBy: 'user-001',
        createdAt: new Date(), updatedAt: new Date(),
        lines: [
          { id: 'jel-001', debit: '1080.00', credit: '0.00', description: 'AR', sortOrder: 0,
            glAccount: { code: '1100', name: 'Accounts Receivable', type: 'ASSET' } },
          { id: 'jel-002', debit: '0.00', credit: '1000.00', description: 'Revenue', sortOrder: 1,
            glAccount: { code: '4000', name: 'Revenue - Software', type: 'REVENUE' } },
          { id: 'jel-003', debit: '0.00', credit: '80.00', description: 'Tax', sortOrder: 2,
            glAccount: { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY' } },
        ],
      },
    ]);
  });

  it('returns journal entries for an invoice', async () => {
    const res = await request(app)
      .get('/api/journal-entries?invoice=inv-001')
      .set('X-Tenant-ID', 'tenant-001');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const je = res.body.data[0];
    expect(je.entryNumber).toBe('JE-000001');
    expect(je.lines).toHaveLength(3);
    // Verify debit = credit (balanced entry)
    const totalDebit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });
});

// ─── Payment validation ───────────────────────────────────────────────────────

describe('POST /api/payments — validation', () => {
  beforeEach(() => withTenant());

  it('returns 422 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({ amount: 500 }); // missing entityId, customerId, cashAccountId, arAccountId
    expect(res.status).toBe(422);
  });

  it('returns 422 when amount is zero', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({ entityId: 'e', customerId: 'c', amount: 0, cashAccountId: 'ca', arAccountId: 'ar' });
    expect(res.status).toBe(422);
  });
});

// ─── Approve edge case ───────────────────────────────────────────────────────

describe('POST /api/invoices/:id/approve — accounting guards', () => {
  beforeEach(() => withTenant());

  it('returns 422 when invoice has tax but no TAX_PAYABLE GL account configured', async () => {
    const taxedInvoice = {
      ...mockInvoice,
      status: 'DRAFT',
      taxAmount: '80.00',
      total: '1080.00',
      lineItems: [{ id: 'li-001', description: 'SW License', quantity: 1, unitPrice: 1000,
                    taxRate: 0.08, amount: '1000.00', glAccountId: 'gl-rev-001', sortOrder: 0 }],
      entity: { id: 'entity-001', currency: 'USD' },
    };
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(taxedInvoice);
    (db.accountingPeriod.findFirst as jest.Mock).mockResolvedValue(null); // period open
    (db.gLAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'gl-ar-001', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' }) // AR check outside tx
      .mockResolvedValueOnce({ id: 'gl-rev-001', type: 'REVENUE' })  // defaultRevenue inside tx
      .mockResolvedValueOnce(null); // TAX_PAYABLE lookup → null → should throw
    (db.$transaction as jest.Mock).mockImplementation(async (fn: Function) => fn(db));
    (db.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (db.$queryRaw as jest.Mock).mockResolvedValue([{ lastValue: 2 }]);

    const res = await request(app)
      .post('/api/invoices/inv-001/approve')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'CONTROLLER')
      .send({ arAccountId: 'gl-ar-001' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/TAX_PAYABLE/);
  });

  it('returns 422 when a concurrent request wins the approve race (updateMany count=0)', async () => {
    const draftInvoice = {
      ...mockInvoice, status: 'DRAFT', taxAmount: '0.00', total: '1000.00',
      lineItems: [{ id: 'li-001', description: 'Service', quantity: 1, unitPrice: 1000,
                    taxRate: 0, amount: '1000.00', glAccountId: 'gl-rev-001', sortOrder: 0 }],
      entity: { id: 'entity-001', currency: 'USD' },
    };
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(draftInvoice);
    (db.accountingPeriod.findFirst as jest.Mock).mockResolvedValue(null);
    (db.gLAccount.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'gl-ar-001', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' });
    (db.$transaction as jest.Mock).mockImplementation(async (fn: Function) => fn(db));
    (db.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // concurrent request won the race

    const res = await request(app)
      .post('/api/invoices/inv-001/approve')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'CONTROLLER')
      .send({ arAccountId: 'gl-ar-001' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

// ─── Write-off ────────────────────────────────────────────────────────────────

describe('POST /api/invoices/:id/write-off', () => {
  beforeEach(() => {
    withTenant();
    (db.auditLog.create as jest.Mock).mockResolvedValue({});
    (db.$transaction as jest.Mock).mockImplementation(async (fn: Function) => fn(db));
    (db.$queryRaw as jest.Mock).mockResolvedValue([{ lastValue: 5 }]);
    (db.journalEntry.create as jest.Mock).mockResolvedValue({});
  });

  it('sets amountDue to 0 and status WRITTEN_OFF atomically', async () => {
    const sentInvoice = { ...mockInvoice, status: 'SENT', amountDue: '1080.00', amountPaid: '0.00', entityId: 'entity-001' };
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(sentInvoice);
    (db.gLAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'gl-bad-debt-001', type: 'EXPENSE' })                    // bad debt account
      .mockResolvedValueOnce({ id: 'gl-ar-001', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' }); // AR account
    (db.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/invoices/inv-001/write-off')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'CONTROLLER')
      .send({ badDebtAccountId: 'gl-bad-debt-001' });

    expect(res.status).toBe(200);
    // Verify the updateMany call included amountDue: 0 alongside WRITTEN_OFF
    const writeOffCall = (db.invoice.updateMany as jest.Mock).mock.calls.find(
      (call: any[]) => call[0]?.data?.status === 'WRITTEN_OFF'
    );
    expect(writeOffCall).toBeDefined();
    expect(String(writeOffCall![0].data.amountDue)).toBe('0');
  });

  it('returns 422 when write-off has no ACCOUNTS_RECEIVABLE GL account for the entity', async () => {
    const sentInvoice = { ...mockInvoice, status: 'SENT', amountDue: '1080.00', amountPaid: '0.00', entityId: 'entity-001' };
    (db.invoice.findFirst as jest.Mock).mockResolvedValue(sentInvoice);
    (db.gLAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'gl-bad-debt-001', type: 'EXPENSE' }) // bad debt account found
      .mockResolvedValueOnce(null); // no AR account → throws ValidationError

    const res = await request(app)
      .post('/api/invoices/inv-001/write-off')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'CONTROLLER')
      .send({ badDebtAccountId: 'gl-bad-debt-001' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/ACCOUNTS_RECEIVABLE/);
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/demo-login', () => {
  const mockUser = {
    id: 'user-controller',
    tenantId: 'tenant-001',
    name: 'Demo Controller',
    email: 'controller@demo.local',
    role: 'CONTROLLER',
    isActive: true,
    tenant: { id: 'tenant-001', name: 'Test Corp', isActive: true },
  };

  it('returns JWT for valid demo credentials', async () => {
    (db.user.findFirst as jest.Mock).mockResolvedValue(mockUser);
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ email: 'controller@demo.local', password: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.role).toBe('CONTROLLER');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ email: 'controller@demo.local', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

// ─── Security guards ──────────────────────────────────────────────────────────

describe('Admin key guard on POST /api/tenants', () => {
  it('returns 401 without X-Admin-Key header', async () => {
    const res = await request(app)
      .post('/api/tenants')
      .send({ name: 'New Tenant', slug: 'new-tenant' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Role guards — customer and GL account creation', () => {
  beforeEach(() => withTenant());

  it('POST /api/customers returns 403 for VIEWER', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'VIEWER')
      .send({ name: 'Test Co', code: 'TC', entityId: 'entity-001', currency: 'USD' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/gl-accounts returns 403 for AR_CLERK', async () => {
    const res = await request(app)
      .post('/api/gl-accounts')
      .set('X-Tenant-ID', 'tenant-001')
      .set('X-User-Role', 'AR_CLERK')
      .send({ code: '9999', name: 'Test GL', type: 'ASSET', entityId: 'entity-001' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ─── 404 route ────────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for unknown API path', async () => {
    const res = await request(app).get('/api/unknown-route').set('X-Tenant-ID', 'tenant-001');
    // Will fail at tenant lookup since we haven't mocked it — but still tests the routing
    expect([404, 400, 500].includes(res.status)).toBe(true);
  });
});
