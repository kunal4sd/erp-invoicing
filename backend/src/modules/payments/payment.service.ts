import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { prisma } from '../../config/database';
import { createAuditLog } from '../../middleware/audit';
import { NotFoundError, ValidationError, PeriodClosedError } from '../../shared/errors';
import { getNextJournalNumber } from '../invoices/invoice.service';
import { PAYABLE_STATES } from '../invoices/invoice.types';

async function validatePeriodOpenForPayment(tenantId: string, date: Date): Promise<void> {
  const period = await prisma.accountingPeriod.findFirst({
    where: { tenantId, fiscalYear: date.getFullYear(), period: date.getMonth() + 1 },
  });
  // Only block if a period row EXISTS and is explicitly CLOSED/LOCKED
  if (period && period.status !== 'OPEN') {
    throw new PeriodClosedError(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    );
  }
}

export interface RecordPaymentDto {
  entityId: string;
  customerId: string;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  paymentDate?: string;
  method?: string;
  referenceNumber?: string;
  idempotencyKey?: string;
  notes?: string;
  cashAccountId: string;
  arAccountId: string;
  // Manual allocation — if omitted, applies to oldest invoices first
  allocations?: Array<{ invoiceId: string; amount: number }>;
}

export async function recordPayment(tenantId: string, userId: string, userName: string, dto: RecordPaymentDto, ipAddress?: string) {
  // Idempotency check — scoped to tenant so different tenants can reuse the same client-generated key
  if (dto.idempotencyKey) {
    const existing = await prisma.payment.findFirst({
      where: { tenantId, idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;
  }

  const customer = await prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
  if (!customer) throw new NotFoundError('Customer', dto.customerId);

  const cashAccount = await prisma.gLAccount.findFirst({
    where: { id: dto.cashAccountId, tenantId, type: 'ASSET' },
  });
  if (!cashAccount) throw new NotFoundError('Cash/Bank GL Account', dto.cashAccountId);

  const arAccount = await prisma.gLAccount.findFirst({
    where: { id: dto.arAccountId, tenantId, type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
  });
  if (!arAccount) throw new NotFoundError('AR GL Account (must be type ASSET, subtype ACCOUNTS_RECEIVABLE)', dto.arAccountId);

  const paymentAmount = new Decimal(dto.amount);
  const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
  await validatePeriodOpenForPayment(tenantId, paymentDate);

  // Determine invoices to allocate against
  let allocations = dto.allocations;
  if (!allocations || allocations.length === 0) {
    // Auto-allocate to oldest open invoices first (FIFO)
    const openInvoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        customerId: dto.customerId,
        status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
      },
      orderBy: { dueDate: 'asc' },
    });

    let remaining = paymentAmount;
    allocations = [];
    for (const inv of openInvoices) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const due = new Decimal(inv.amountDue.toString());
      const apply = Decimal.min(remaining, due);
      allocations.push({ invoiceId: inv.id, amount: apply.toNumber() });
      remaining = remaining.minus(apply);
    }
  } else {
    // Validate manual allocations
    const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
    if (new Decimal(totalAllocated).greaterThan(paymentAmount)) {
      throw new ValidationError('Total allocated amount exceeds payment amount');
    }
  }

  // Validate all invoices belong to this customer and tenant
  for (const alloc of allocations) {
    const inv = await prisma.invoice.findFirst({
      where: { id: alloc.invoiceId, tenantId, customerId: dto.customerId },
    });
    if (!inv) throw new NotFoundError('Invoice', alloc.invoiceId);
    if (!PAYABLE_STATES.has(inv.status)) {
      throw new ValidationError(`Invoice ${inv.invoiceNumber} is not in a payable state (status: ${inv.status})`);
    }
    const due = new Decimal(inv.amountDue.toString());
    if (new Decimal(alloc.amount).greaterThan(due.plus(0.01))) {
      throw new ValidationError(`Allocation of ${alloc.amount} exceeds invoice ${inv.invoiceNumber} balance of ${due}`);
    }
  }

  const totalAllocated = allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
  const unapplied = paymentAmount.minus(totalAllocated);

  const result = await prisma
    .$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        tenantId,
        entityId: dto.entityId,
        customerId: dto.customerId,
        amount: paymentAmount,
        currency: dto.currency ?? customer.currency,
        exchangeRate: new Decimal(dto.exchangeRate ?? 1),
        paymentDate,
        method: (dto.method as any) ?? 'BANK_TRANSFER',
        referenceNumber: dto.referenceNumber,
        status: totalAllocated.greaterThan(0) ? (unapplied.greaterThan(0) ? 'PARTIALLY_APPLIED' : 'APPLIED') : 'UNAPPLIED',
        unappliedAmount: unapplied,
        idempotencyKey: dto.idempotencyKey,
        createdBy: userId,
        notes: dto.notes,
      },
    });

    // Apply allocations and update invoice statuses.
    // SELECT FOR UPDATE locks each invoice row for the duration of this transaction,
    // preventing a concurrent payment from reading the same amountDue and over-allocating.
    for (const alloc of allocations) {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        amountPaid: unknown;
        amountDue: unknown;
        total: unknown;
        status: string;
      }>>`
        SELECT id, "amountPaid", "amountDue", total, status
        FROM "Invoice"
        WHERE id = ${alloc.invoiceId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      if (!rows.length) continue;
      const inv = rows[0];

      const allocAmount = new Decimal(alloc.amount);
      const currentDue = new Decimal(String(inv.amountDue));

      // Re-validate inside the lock: a concurrent transaction may have already reduced amountDue
      if (allocAmount.greaterThan(currentDue.plus(new Decimal('0.01')))) {
        throw new ValidationError(
          `Invoice ${alloc.invoiceId} has insufficient balance ($${currentDue.toFixed(2)}) ` +
          `for allocation of $${allocAmount.toFixed(2)}. ` +
          `A concurrent payment may have already applied funds — please retry.`
        );
      }

      const newPaid = new Decimal(String(inv.amountPaid)).plus(allocAmount);
      const newDue = new Decimal(String(inv.total)).minus(newPaid);
      const newStatus = newDue.lessThanOrEqualTo(0.001) ? 'PAID' : 'PARTIALLY_PAID';

      await tx.invoice.update({
        where: { id: alloc.invoiceId },
        data: { amountPaid: newPaid, amountDue: Decimal.max(newDue, 0), status: newStatus },
      });

      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: alloc.invoiceId,
          amount: allocAmount,
          appliedBy: userId,
        },
      });
    }

    // GL Journal Entry: DR Cash/Bank, CR Accounts Receivable
    if (totalAllocated.greaterThan(0)) {
      const entryNumber = await getNextJournalNumber(tenantId, tx);
      await tx.journalEntry.create({
        data: {
          tenantId,
          entityId: dto.entityId,
          entryNumber,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
          postingDate: paymentDate,
          period: paymentDate.getMonth() + 1,
          fiscalYear: paymentDate.getFullYear(),
          status: 'POSTED',
          description: `Payment received: ${dto.referenceNumber ?? payment.id}`,
          totalDebit: totalAllocated,
          totalCredit: totalAllocated,
          createdBy: userId,
          lines: {
            createMany: {
              data: [
                {
                  glAccountId: cashAccount.id,
                  debit: totalAllocated,
                  credit: new Decimal(0),
                  description: 'Cash/Bank received',
                  sortOrder: 0,
                },
                {
                  glAccountId: arAccount.id,
                  debit: new Decimal(0),
                  credit: totalAllocated,
                  description: 'AR cleared',
                  sortOrder: 1,
                },
              ],
            },
          },
        },
      });
    }

      return payment;
    })
    .catch(async (err: unknown) => {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        dto.idempotencyKey &&
        String(err.meta?.target ?? '').toLowerCase().includes('idempotency')
      ) {
        const existing = await prisma.payment.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } });
        if (existing) return existing;
      }
      throw err;
    });

  await createAuditLog({
    tenantId,
    entityType: 'Payment',
    entityId: result.id,
    action: 'CREATED',
    userId,
    userName,
    ipAddress,
    newValues: {
      amount: paymentAmount.toFixed(2),
      allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
    },
  });

  return result;
}

export async function getPaymentById(tenantId: string, id: string) {
  const payment = await prisma.payment.findFirst({
    where: { id, tenantId },
    include: {
      allocations: {
        include: {
          invoice: { select: { invoiceNumber: true, total: true, status: true } },
        },
      },
      customer: { select: { name: true, code: true } },
    },
  });
  if (!payment) throw new NotFoundError('Payment', id);
  return payment;
}
