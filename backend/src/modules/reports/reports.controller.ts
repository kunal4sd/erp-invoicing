import { Request, Response } from 'express';
import Decimal from 'decimal.js';
import { prisma } from '../../config/database';

export async function arSummaryHandler(req: Request, res: Response): Promise<void> {
  const entityId = req.query.entityId as string | undefined;

  const [agg, invoiceCount] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        tenantId: req.tenantId,
        ...(entityId && { entityId }),
        status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
      },
      _sum: { total: true, amountPaid: true, amountDue: true },
    }),
    prisma.invoice.count({
      where: {
        tenantId: req.tenantId,
        ...(entityId && { entityId }),
        status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      totalBilled: new Decimal(agg._sum.total?.toString() ?? '0').toFixed(2),
      totalPaid: new Decimal(agg._sum.amountPaid?.toString() ?? '0').toFixed(2),
      totalOutstanding: new Decimal(agg._sum.amountDue?.toString() ?? '0').toFixed(2),
      invoiceCount,
    },
  });
}

export async function arAgingAllHandler(req: Request, res: Response): Promise<void> {
  const entityId = req.query.entityId as string | undefined;
  const today = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId: req.tenantId,
      ...(entityId && { entityId }),
      status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
    },
    include: { customer: { select: { id: true, name: true, code: true } } },
    orderBy: [{ customer: { name: 'asc' } }, { dueDate: 'asc' }],
  });

  // Group by customer
  const byCustomer = new Map<string, { customer: { id: string; name: string; code: string }; current: number; b30: number; b60: number; b90: number; over90: number; total: number }>();

  for (const inv of invoices) {
    const days = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
    const due = parseFloat(inv.amountDue.toString());
    const cId = inv.customer.id;

    if (!byCustomer.has(cId)) {
      byCustomer.set(cId, { customer: inv.customer, current: 0, b30: 0, b60: 0, b90: 0, over90: 0, total: 0 });
    }
    const row = byCustomer.get(cId)!;
    row.total += due;
    if (days <= 0) row.current += due;
    else if (days <= 30) row.b30 += due;
    else if (days <= 60) row.b60 += due;
    else if (days <= 90) row.b90 += due;
    else row.over90 += due;
  }

  const rows = Array.from(byCustomer.values()).map((r) => ({
    customerId: r.customer.id,
    customerName: r.customer.name,
    customerCode: r.customer.code,
    current: r.current.toFixed(2),
    days_1_30: r.b30.toFixed(2),
    days_31_60: r.b60.toFixed(2),
    days_61_90: r.b90.toFixed(2),
    days_over_90: r.over90.toFixed(2),
    total: r.total.toFixed(2),
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      current: (parseFloat(acc.current) + parseFloat(r.current)).toFixed(2),
      days_1_30: (parseFloat(acc.days_1_30) + parseFloat(r.days_1_30)).toFixed(2),
      days_31_60: (parseFloat(acc.days_31_60) + parseFloat(r.days_31_60)).toFixed(2),
      days_61_90: (parseFloat(acc.days_61_90) + parseFloat(r.days_61_90)).toFixed(2),
      days_over_90: (parseFloat(acc.days_over_90) + parseFloat(r.days_over_90)).toFixed(2),
      total: (parseFloat(acc.total) + parseFloat(r.total)).toFixed(2),
    }),
    { current: '0', days_1_30: '0', days_31_60: '0', days_61_90: '0', days_over_90: '0', total: '0' }
  );

  res.json({
    success: true,
    data: {
      asOfDate: today.toISOString().split('T')[0],
      rows,
      totals,
    },
  });
}

export async function glReconciliationHandler(req: Request, res: Response): Promise<void> {
  const entityId = req.query.entityId as string | undefined;

  // AR Subledger total = sum of all open invoice amountDue
  const invoices = await prisma.invoice.aggregate({
    where: {
      tenantId: req.tenantId,
      ...(entityId && { entityId }),
      status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
    },
    _sum: { amountDue: true },
  });

  // GL AR balance = sum of all ASSET journal lines for AR accounts
  const arAccounts = await prisma.gLAccount.findMany({
    where: { tenantId: req.tenantId, ...(entityId && { entityId }), type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
    select: { id: true },
  });

  const glBalance = await prisma.journalEntryLine.aggregate({
    where: {
      glAccountId: { in: arAccounts.map((a) => a.id) },
      journalEntry: { tenantId: req.tenantId, status: 'POSTED' },
    },
    _sum: { debit: true, credit: true },
  });

  const glDebit = parseFloat(glBalance._sum.debit?.toString() ?? '0');
  const glCredit = parseFloat(glBalance._sum.credit?.toString() ?? '0');
  const glNet = glDebit - glCredit;
  const subledgerTotal = parseFloat(invoices._sum.amountDue?.toString() ?? '0');
  const variance = subledgerTotal - glNet;

  res.json({
    success: true,
    data: {
      arSubledgerBalance: subledgerTotal.toFixed(2),
      glArBalance: glNet.toFixed(2),
      variance: variance.toFixed(2),
      isReconciled: Math.abs(variance) < 0.01,
    },
  });
}
