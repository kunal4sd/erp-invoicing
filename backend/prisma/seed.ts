import { PrismaClient, InvoiceStatus, PaymentStatus, JournalEntryStatus, JournalRefType } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

function periodOf(d: Date) {
  return { period: d.getMonth() + 1, fiscalYear: d.getFullYear() };
}

async function createJE(opts: {
  tenantId: string;
  entityId: string;
  entryNumber: string;
  referenceType: JournalRefType;
  referenceId: string;
  invoiceId?: string;
  postingDate: Date;
  description: string;
  createdBy: string;
  reversalOf?: string;
  lines: { glAccountId: string; debit: number; credit: number; description: string }[];
}) {
  const existing = await prisma.journalEntry.findUnique({
    where: { tenantId_entryNumber: { tenantId: opts.tenantId, entryNumber: opts.entryNumber } },
  });
  if (existing) return existing;

  const total = opts.lines.reduce((s, l) => s + l.debit, 0);
  const { period, fiscalYear } = periodOf(opts.postingDate);

  return prisma.journalEntry.create({
    data: {
      tenantId: opts.tenantId,
      entityId: opts.entityId,
      entryNumber: opts.entryNumber,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      invoiceId: opts.invoiceId,
      postingDate: opts.postingDate,
      period,
      fiscalYear,
      status: JournalEntryStatus.POSTED,
      description: opts.description,
      totalDebit: new Decimal(total),
      totalCredit: new Decimal(total),
      reversalOf: opts.reversalOf,
      createdBy: opts.createdBy,
      lines: {
        create: opts.lines.map((l, i) => ({
          glAccountId: l.glAccountId,
          debit: new Decimal(l.debit),
          credit: new Decimal(l.credit),
          description: l.description,
          sortOrder: i,
        })),
      },
    },
  });
}

async function findOrCreateInvoice(
  tenantId: string,
  invoiceNumber: string,
  data: Parameters<typeof prisma.invoice.create>[0]['data'],
) {
  const existing = await prisma.invoice.findUnique({
    where: { tenantId_invoiceNumber: { tenantId, invoiceNumber } },
  });
  if (existing) return existing;
  return prisma.invoice.create({ data });
}

async function main() {
  console.log('🌱 Seeding database...');

  // ── Tenants ───────────────────────────────────────────────────────────────────

  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: { name: 'Acme Corporation', slug: 'acme-corp', baseCurrency: 'USD' },
  });

  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'globex-inc' },
    update: {},
    create: { name: 'Globex Inc.', slug: 'globex-inc', baseCurrency: 'USD' },
  });

  console.log(`Tenants: ${tenantA.id} (Acme), ${tenantB.id} (Globex)`);

  // ── Users (demo login — password is DEMO_USER_PASSWORD env var, default "demo") ──

  const demoUsers = [
    { email: 'viewer@demo.local', name: 'Demo Viewer', role: 'VIEWER' as const },
    { email: 'clerk@demo.local', name: 'Demo AR Clerk', role: 'AR_CLERK' as const },
    { email: 'controller@demo.local', name: 'Demo Controller', role: 'CONTROLLER' as const },
  ];

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenantA.id, email: u.email } },
      update: { name: u.name, role: u.role, isActive: true },
      create: { tenantId: tenantA.id, name: u.name, email: u.email, role: u.role },
    });
  }

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenantA.id, email: 'admin@acme.com' } },
    update: {},
    create: { tenantId: tenantA.id, name: 'Acme Admin', email: 'admin@acme.com', role: 'ADMIN' },
  });

  // ── Entities ──────────────────────────────────────────────────────────────────

  const parentEntity = await prisma.entity.upsert({
    where: { tenantId_code: { tenantId: tenantA.id, code: 'ACME-HQ' } },
    update: {},
    create: {
      tenantId: tenantA.id,
      name: 'Acme Corporation HQ',
      code: 'ACME-HQ',
      type: 'PARENT',
      currency: 'USD',
    },
  });

  const subEntity = await prisma.entity.upsert({
    where: { tenantId_code: { tenantId: tenantA.id, code: 'ACME-EU' } },
    update: {},
    create: {
      tenantId: tenantA.id,
      parentEntityId: parentEntity.id,
      name: 'Acme Europe Ltd.',
      code: 'ACME-EU',
      type: 'SUBSIDIARY',
      currency: 'EUR',
    },
  });

  console.log(`Entities: ${parentEntity.id} (HQ), ${subEntity.id} (EU)`);

  // ── Chart of Accounts ─────────────────────────────────────────────────────────

  const arAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '1100' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '1100', name: 'Accounts Receivable', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
  });

  const cashAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '1010' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '1010', name: 'Cash - Operating Account', type: 'ASSET', subtype: 'CASH' },
  });

  const revenueAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '4000' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '4000', name: 'Revenue - Software Licenses', type: 'REVENUE' },
  });

  const serviceAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '4100' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '4100', name: 'Revenue - Professional Services', type: 'REVENUE' },
  });

  const taxPayableAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '2200' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', subtype: 'TAX_PAYABLE' },
  });

  const badDebtAccount = await prisma.gLAccount.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: '6100' } },
    update: {},
    create: { tenantId: tenantA.id, entityId: parentEntity.id, code: '6100', name: 'Bad Debt Expense', type: 'EXPENSE' },
  });

  console.log('GL Accounts created');

  // ── Customers ─────────────────────────────────────────────────────────────────

  const customerAlpha = await prisma.customer.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: 'CUST-001' } },
    update: {},
    create: {
      tenantId: tenantA.id, entityId: parentEntity.id,
      code: 'CUST-001', name: 'Alpha Tech Solutions',
      email: 'billing@alphatech.com', currency: 'USD',
      creditLimit: new Decimal(50000), paymentTerms: 30,
      arAccountId: arAccount.id,
    },
  });

  const customerBeta = await prisma.customer.upsert({
    where: { tenantId_entityId_code: { tenantId: tenantA.id, entityId: parentEntity.id, code: 'CUST-002' } },
    update: {},
    create: {
      tenantId: tenantA.id, entityId: parentEntity.id,
      code: 'CUST-002', name: 'Beta Enterprises',
      email: 'accounts@beta.com', currency: 'USD',
      creditLimit: new Decimal(25000), paymentTerms: 45,
      arAccountId: arAccount.id,
    },
  });

  console.log(`Customers: ${customerAlpha.id}, ${customerBeta.id}`);

  // ── Accounting Periods ────────────────────────────────────────────────────────

  const now = new Date();
  const year = now.getFullYear();
  for (let m = 1; m <= 12; m++) {
    const startDate = new Date(year, m - 1, 1);
    const endDate = new Date(year, m, 0);
    await prisma.accountingPeriod.upsert({
      where: { tenantId_fiscalYear_period: { tenantId: tenantA.id, fiscalYear: year, period: m } },
      update: {},
      create: {
        tenantId: tenantA.id, fiscalYear: year, period: m,
        startDate, endDate,
        status: m < now.getMonth() + 1 ? 'CLOSED' : 'OPEN',
      },
    });
  }

  // ── Exchange Rates ────────────────────────────────────────────────────────────

  await prisma.exchangeRate.upsert({
    where: { tenantId_fromCurrency_toCurrency_effectiveDate: { tenantId: tenantA.id, fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: new Date('2024-01-01') } },
    update: {},
    create: { tenantId: tenantA.id, fromCurrency: 'EUR', toCurrency: 'USD', rate: new Decimal(1.0853), effectiveDate: new Date('2024-01-01'), source: 'ECB' },
  });

  // ── Demo Invoices ─────────────────────────────────────────────────────────────

  console.log('Creating demo invoices...');

  const SYSTEM = 'seed-system';
  const CONTROLLER = 'controller-001';

  // INV-000001 · PAID · Alpha Tech · $12,050 ────────────────────────────────────
  // Enterprise SW license + implementation, paid in full via wire transfer 60 days ago

  const inv1 = await findOrCreateInvoice(tenantA.id, 'INV-000001', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
    invoiceNumber: 'INV-000001',
    status: InvoiceStatus.PAID,
    issueDate: daysAgo(60), dueDate: daysAgo(30),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(11250), taxAmount: new Decimal(800), total: new Decimal(12050),
    amountPaid: new Decimal(12050), amountDue: new Decimal(0),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(58),
    notes: 'Enterprise license + implementation Q2. Paid in full.',
    lineItems: {
      create: [
        { description: 'Enterprise Software License — Q2 2026', quantity: new Decimal(1), unitPrice: new Decimal(10000), taxRate: new Decimal(0.08), amount: new Decimal(10000), glAccountId: revenueAccount.id, sortOrder: 0 },
        { description: 'Implementation Services (5 hrs)', quantity: new Decimal(5), unitPrice: new Decimal(250), taxRate: new Decimal(0), amount: new Decimal(1250), glAccountId: serviceAccount.id, sortOrder: 1 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000001', referenceType: 'INVOICE', referenceId: inv1.id, invoiceId: inv1.id,
    postingDate: daysAgo(58), description: 'Invoice approved: INV-000001 — Alpha Tech Solutions', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,       debit: 12050, credit: 0,     description: 'AR — Alpha Tech Solutions' },
      { glAccountId: revenueAccount.id,  debit: 0,     credit: 10000, description: 'Revenue — SW License' },
      { glAccountId: serviceAccount.id,  debit: 0,     credit: 1250,  description: 'Revenue — Implementation' },
      { glAccountId: taxPayableAccount.id, debit: 0,   credit: 800,   description: 'Sales Tax Payable' },
    ],
  });

  const pay1 = await prisma.payment.findFirst({ where: { tenantId: tenantA.id, idempotencyKey: 'seed-pay-inv-000001' } })
    ?? await prisma.payment.create({
      data: {
        tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
        amount: new Decimal(12050), currency: 'USD', paymentDate: daysAgo(25),
        method: 'WIRE', referenceNumber: 'WIRE-2026-0605-001',
        status: PaymentStatus.APPLIED, unappliedAmount: new Decimal(0),
        idempotencyKey: 'seed-pay-inv-000001', createdBy: SYSTEM,
        notes: 'Full payment received via wire transfer',
      },
    });

  await prisma.paymentAllocation.upsert({
    where: { paymentId_invoiceId: { paymentId: pay1.id, invoiceId: inv1.id } },
    update: {},
    create: { paymentId: pay1.id, invoiceId: inv1.id, amount: new Decimal(12050), appliedBy: SYSTEM },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000002', referenceType: 'PAYMENT', referenceId: pay1.id,
    postingDate: daysAgo(25), description: 'Payment received: INV-000001 — $12,050 wire transfer', createdBy: SYSTEM,
    lines: [
      { glAccountId: cashAccount.id, debit: 12050, credit: 0,     description: 'Cash received — wire transfer' },
      { glAccountId: arAccount.id,   debit: 0,     credit: 12050, description: 'AR cleared — Alpha Tech Solutions' },
    ],
  });

  // INV-000002 · PARTIALLY_PAID · Alpha Tech · $5,000 ($2,000 paid, $3,000 overdue) ──

  const inv2 = await findOrCreateInvoice(tenantA.id, 'INV-000002', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
    invoiceNumber: 'INV-000002',
    status: InvoiceStatus.PARTIALLY_PAID,
    issueDate: daysAgo(45), dueDate: daysAgo(15),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(5000), taxAmount: new Decimal(0), total: new Decimal(5000),
    amountPaid: new Decimal(2000), amountDue: new Decimal(3000),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(43),
    notes: 'Partial payment received. Balance $3,000 overdue — follow up required.',
    lineItems: {
      create: [
        { description: 'Strategic Consulting Services (20 hrs)', quantity: new Decimal(20), unitPrice: new Decimal(250), taxRate: new Decimal(0), amount: new Decimal(5000), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000003', referenceType: 'INVOICE', referenceId: inv2.id, invoiceId: inv2.id,
    postingDate: daysAgo(43), description: 'Invoice approved: INV-000002 — Alpha Tech Solutions', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,      debit: 5000, credit: 0,    description: 'AR — Alpha Tech Solutions' },
      { glAccountId: serviceAccount.id, debit: 0,    credit: 5000, description: 'Revenue — Consulting Services' },
    ],
  });

  const pay2 = await prisma.payment.findFirst({ where: { tenantId: tenantA.id, idempotencyKey: 'seed-pay-inv-000002' } })
    ?? await prisma.payment.create({
      data: {
        tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
        amount: new Decimal(2000), currency: 'USD', paymentDate: daysAgo(10),
        method: 'ACH', referenceNumber: 'ACH-2026-0620-042',
        status: PaymentStatus.APPLIED, unappliedAmount: new Decimal(0),
        idempotencyKey: 'seed-pay-inv-000002', createdBy: SYSTEM,
        notes: 'Partial payment — balance $3,000 outstanding (overdue 15 days)',
      },
    });

  await prisma.paymentAllocation.upsert({
    where: { paymentId_invoiceId: { paymentId: pay2.id, invoiceId: inv2.id } },
    update: {},
    create: { paymentId: pay2.id, invoiceId: inv2.id, amount: new Decimal(2000), appliedBy: SYSTEM },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000004', referenceType: 'PAYMENT', referenceId: pay2.id,
    postingDate: daysAgo(10), description: 'Partial payment: INV-000002 — $2,000 ACH', createdBy: SYSTEM,
    lines: [
      { glAccountId: cashAccount.id, debit: 2000, credit: 0,    description: 'Cash received — ACH' },
      { glAccountId: arAccount.id,   debit: 0,    credit: 2000, description: 'AR partially cleared — Alpha Tech' },
    ],
  });

  // INV-000003 · SENT (OVERDUE 45 days) · Beta Enterprises · $8,500 ─────────────

  const inv3 = await findOrCreateInvoice(tenantA.id, 'INV-000003', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerBeta.id,
    invoiceNumber: 'INV-000003',
    status: InvoiceStatus.SENT,
    issueDate: daysAgo(75), dueDate: daysAgo(45),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(8500), taxAmount: new Decimal(0), total: new Decimal(8500),
    amountPaid: new Decimal(0), amountDue: new Decimal(8500),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(73),
    notes: 'Annual maintenance contract FY2026. 45 DAYS OVERDUE — escalate to collections.',
    lineItems: {
      create: [
        { description: 'Annual Software Maintenance Contract — FY2026', quantity: new Decimal(1), unitPrice: new Decimal(8500), taxRate: new Decimal(0), amount: new Decimal(8500), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000005', referenceType: 'INVOICE', referenceId: inv3.id, invoiceId: inv3.id,
    postingDate: daysAgo(73), description: 'Invoice approved: INV-000003 — Beta Enterprises', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,      debit: 8500, credit: 0,    description: 'AR — Beta Enterprises' },
      { glAccountId: serviceAccount.id, debit: 0,    credit: 8500, description: 'Revenue — Annual Maintenance' },
    ],
  });

  // INV-000004 · SENT (due in 25 days) · Beta Enterprises · $3,200 ──────────────

  const inv4 = await findOrCreateInvoice(tenantA.id, 'INV-000004', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerBeta.id,
    invoiceNumber: 'INV-000004',
    status: InvoiceStatus.SENT,
    issueDate: daysAgo(5), dueDate: daysFromNow(25),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(3200), taxAmount: new Decimal(0), total: new Decimal(3200),
    amountPaid: new Decimal(0), amountDue: new Decimal(3200),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(4),
    notes: 'Q3 support services package — due in 25 days.',
    lineItems: {
      create: [
        { description: 'Technical Support Services — Q3 2026', quantity: new Decimal(1), unitPrice: new Decimal(3200), taxRate: new Decimal(0), amount: new Decimal(3200), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000006', referenceType: 'INVOICE', referenceId: inv4.id, invoiceId: inv4.id,
    postingDate: daysAgo(4), description: 'Invoice approved: INV-000004 — Beta Enterprises', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,      debit: 3200, credit: 0,    description: 'AR — Beta Enterprises' },
      { glAccountId: serviceAccount.id, debit: 0,    credit: 3200, description: 'Revenue — Support Services' },
    ],
  });

  // INV-000005 · APPROVED (not yet sent) · Alpha Tech · $16,200 w/ 8% tax ────────

  const inv5 = await findOrCreateInvoice(tenantA.id, 'INV-000005', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
    invoiceNumber: 'INV-000005',
    status: InvoiceStatus.APPROVED,
    issueDate: daysAgo(2), dueDate: daysFromNow(28),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(15000), taxAmount: new Decimal(1200), total: new Decimal(16200),
    amountPaid: new Decimal(0), amountDue: new Decimal(16200),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(1),
    notes: 'Enterprise license renewal FY2027. Approved — awaiting send.',
    lineItems: {
      create: [
        { description: 'Enterprise License Renewal — FY2027', quantity: new Decimal(1), unitPrice: new Decimal(15000), taxRate: new Decimal(0.08), amount: new Decimal(15000), glAccountId: revenueAccount.id, sortOrder: 0 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000007', referenceType: 'INVOICE', referenceId: inv5.id, invoiceId: inv5.id,
    postingDate: daysAgo(1), description: 'Invoice approved: INV-000005 — Alpha Tech Solutions', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,         debit: 16200, credit: 0,     description: 'AR — Alpha Tech Solutions' },
      { glAccountId: revenueAccount.id,    debit: 0,     credit: 15000, description: 'Revenue — License Renewal' },
      { glAccountId: taxPayableAccount.id, debit: 0,     credit: 1200,  description: 'Sales Tax Payable (8%)' },
    ],
  });

  // INV-000006 · DRAFT · Beta Enterprises · $2,500 ─────────────────────────────

  await findOrCreateInvoice(tenantA.id, 'INV-000006', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerBeta.id,
    invoiceNumber: 'INV-000006',
    status: InvoiceStatus.DRAFT,
    issueDate: new Date(), dueDate: daysFromNow(30),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(2500), taxAmount: new Decimal(0), total: new Decimal(2500),
    amountPaid: new Decimal(0), amountDue: new Decimal(2500),
    createdBy: SYSTEM,
    notes: 'Custom integration development — pending internal review before sending.',
    lineItems: {
      create: [
        { description: 'Custom API Integration Development (40 hrs)', quantity: new Decimal(40), unitPrice: new Decimal(62.5), taxRate: new Decimal(0), amount: new Decimal(2500), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  // INV-000007 · VOID · Alpha Tech · $1,000 (duplicate, voided with GL reversal) ─

  const inv7 = await findOrCreateInvoice(tenantA.id, 'INV-000007', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerAlpha.id,
    invoiceNumber: 'INV-000007',
    status: InvoiceStatus.VOID,
    issueDate: daysAgo(10), dueDate: daysFromNow(20),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(1000), taxAmount: new Decimal(0), total: new Decimal(1000),
    amountPaid: new Decimal(0), amountDue: new Decimal(0),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(9),
    voidedBy: CONTROLLER, voidedAt: daysAgo(8),
    notes: 'Voided — duplicate of INV-000002. GL entries reversed.',
    lineItems: {
      create: [
        { description: 'Support Contract (DUPLICATE — VOIDED)', quantity: new Decimal(1), unitPrice: new Decimal(1000), taxRate: new Decimal(0), amount: new Decimal(1000), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  const je8 = await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000008', referenceType: 'INVOICE', referenceId: inv7.id, invoiceId: inv7.id,
    postingDate: daysAgo(9), description: 'Invoice approved: INV-000007 — Alpha Tech Solutions', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,      debit: 1000, credit: 0,    description: 'AR — Alpha Tech Solutions' },
      { glAccountId: serviceAccount.id, debit: 0,    credit: 1000, description: 'Revenue — Support Contract' },
    ],
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000009', referenceType: 'INVOICE', referenceId: inv7.id, invoiceId: inv7.id,
    postingDate: daysAgo(8), description: 'REVERSAL — Invoice voided: INV-000007 (duplicate)',
    createdBy: CONTROLLER, reversalOf: je8.entryNumber,
    lines: [
      { glAccountId: serviceAccount.id, debit: 1000, credit: 0,    description: 'Revenue reversal — voided invoice' },
      { glAccountId: arAccount.id,      debit: 0,    credit: 1000, description: 'AR cleared — invoice voided' },
    ],
  });

  // INV-000008 · WRITTEN_OFF · Beta Enterprises · $4,200 (bad debt) ────────────

  const inv8 = await findOrCreateInvoice(tenantA.id, 'INV-000008', {
    tenantId: tenantA.id, entityId: parentEntity.id, customerId: customerBeta.id,
    invoiceNumber: 'INV-000008',
    status: InvoiceStatus.WRITTEN_OFF,
    issueDate: daysAgo(120), dueDate: daysAgo(90),
    currency: 'USD', exchangeRate: new Decimal(1),
    subtotal: new Decimal(4200), taxAmount: new Decimal(0), total: new Decimal(4200),
    amountPaid: new Decimal(0), amountDue: new Decimal(0),
    createdBy: SYSTEM, approvedBy: CONTROLLER, approvedAt: daysAgo(118),
    notes: 'Written off as bad debt — customer non-responsive for 90+ days.',
    lineItems: {
      create: [
        { description: 'Legacy Project Services — Phase 2', quantity: new Decimal(1), unitPrice: new Decimal(4200), taxRate: new Decimal(0), amount: new Decimal(4200), glAccountId: serviceAccount.id, sortOrder: 0 },
      ],
    },
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000010', referenceType: 'INVOICE', referenceId: inv8.id, invoiceId: inv8.id,
    postingDate: daysAgo(118), description: 'Invoice approved: INV-000008 — Beta Enterprises', createdBy: CONTROLLER,
    lines: [
      { glAccountId: arAccount.id,      debit: 4200, credit: 0,    description: 'AR — Beta Enterprises' },
      { glAccountId: serviceAccount.id, debit: 0,    credit: 4200, description: 'Revenue — Legacy Project' },
    ],
  });

  await createJE({
    tenantId: tenantA.id, entityId: parentEntity.id,
    entryNumber: 'JE-000011', referenceType: 'INVOICE', referenceId: inv8.id, invoiceId: inv8.id,
    postingDate: daysAgo(30), description: 'Bad debt write-off: INV-000008 — Beta Enterprises ($4,200)', createdBy: CONTROLLER,
    lines: [
      { glAccountId: badDebtAccount.id, debit: 4200, credit: 0,    description: 'Bad Debt Expense' },
      { glAccountId: arAccount.id,      debit: 0,    credit: 4200, description: 'AR written off — Beta Enterprises' },
    ],
  });

  console.log('Demo invoices created (8 invoices across all statuses)');

  // Sync SequenceCounter to the max numbers used by seed data.
  // The seed creates invoices/JEs directly (bypassing the API service), so the counter
  // table is not automatically updated. Without this, the first real API-created invoice
  // would generate INV-000001 and collide with the seed data.
  await prisma.$executeRaw`
    INSERT INTO "SequenceCounter" ("tenantId", "counterName", "lastValue")
    SELECT "tenantId", 'INV', MAX(CAST(SPLIT_PART("invoiceNumber", '-', 2) AS INTEGER))
    FROM "Invoice"
    WHERE "tenantId" = ${tenantA.id}
    GROUP BY "tenantId"
    ON CONFLICT ("tenantId", "counterName")
    DO UPDATE SET "lastValue" = GREATEST("SequenceCounter"."lastValue", EXCLUDED."lastValue")
  `;

  await prisma.$executeRaw`
    INSERT INTO "SequenceCounter" ("tenantId", "counterName", "lastValue")
    SELECT "tenantId", 'JE', MAX(CAST(SPLIT_PART("entryNumber", '-', 2) AS INTEGER))
    FROM "JournalEntry"
    WHERE "tenantId" = ${tenantA.id}
    GROUP BY "tenantId"
    ON CONFLICT ("tenantId", "counterName")
    DO UPDATE SET "lastValue" = GREATEST("SequenceCounter"."lastValue", EXCLUDED."lastValue")
  `;

  console.log('Sequence counters synced (next invoice: INV-000009, next JE: JE-000012)');

  console.log(`
✅ Seed complete!

--- IMPORTANT IDs for API testing ---
Tenant A (Acme):      ${tenantA.id}
Tenant B (Globex):    ${tenantB.id}
Entity (HQ):          ${parentEntity.id}
Entity (EU Sub):      ${subEntity.id}
Customer Alpha:       ${customerAlpha.id}
Customer Beta:        ${customerBeta.id}
AR Account (1100):    ${arAccount.id}
Cash Account (1010):  ${cashAccount.id}
Revenue - SW (4000):  ${revenueAccount.id}
Revenue - Svc (4100): ${serviceAccount.id}
Bad Debt Exp (6100):  ${badDebtAccount.id}

--- Demo Invoice Summary ---
INV-000001  PAID           Alpha Tech   $12,050  (wire transfer — paid in full)
INV-000002  PARTIALLY_PAID Alpha Tech   $ 5,000  ($2,000 paid, $3,000 due — overdue 15d)
INV-000003  SENT OVERDUE   Beta Enter.  $ 8,500  (45 days overdue — escalate to collections)
INV-000004  SENT           Beta Enter.  $ 3,200  (not yet due — due in 25 days)
INV-000005  APPROVED       Alpha Tech   $16,200  (approved with 8% tax — not yet sent)
INV-000006  DRAFT          Beta Enter.  $ 2,500  (custom dev — pending review)
INV-000007  VOID           Alpha Tech   $ 1,000  (duplicate — voided with GL reversal)
INV-000008  WRITTEN_OFF    Beta Enter.  $ 4,200  (bad debt — 90+ days overdue)

11 journal entries · 2 payments · 2 payment allocations

--- Demo login (UI) — password: demo (or DEMO_USER_PASSWORD env) ---
viewer@demo.local      VIEWER
clerk@demo.local       AR_CLERK
controller@demo.local  CONTROLLER
POST /api/auth/demo-login → returns JWT for Authorization: Bearer header

Use Tenant A ID as X-Tenant-ID header on all API requests (or login via UI).
Frontend login page issues JWT — role/tenant headers are not trusted when JWT is present.
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
