import { Prisma, PrismaClient, InvoiceStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { prisma } from '../../config/database';
import { createAuditLog } from '../../middleware/audit';
import {
  NotFoundError,
  InvalidStateTransitionError,
  ValidationError,
  PeriodClosedError,
} from '../../shared/errors';
import {
  CreateInvoiceDto,
  ApproveInvoiceDto,
  InvoiceFilterDto,
  VALID_TRANSITIONS,
  PAYABLE_STATES,
} from './invoice.types';

// Atomically increment and return the next value for a named per-tenant counter.
// Uses INSERT ... ON CONFLICT DO UPDATE in a single statement — no two concurrent
// callers can receive the same value, even inside the same database transaction.
export async function getNextSequence(
  tenantId: string,
  counterName: string,
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "SequenceCounter" ("tenantId", "counterName", "lastValue")
    VALUES (${tenantId}, ${counterName}, 1)
    ON CONFLICT ("tenantId", "counterName")
    DO UPDATE SET "lastValue" = "SequenceCounter"."lastValue" + 1
    RETURNING "lastValue"
  `;
  return Number(rows[0].lastValue);
}

async function getNextInvoiceNumber(
  tenantId: string,
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
): Promise<string> {
  const n = await getNextSequence(tenantId, 'INV', tx);
  return `INV-${String(n).padStart(6, '0')}`;
}

async function validatePeriodOpen(tenantId: string, date: Date): Promise<void> {
  const period = await prisma.accountingPeriod.findFirst({
    where: {
      tenantId,
      fiscalYear: date.getFullYear(),
      period: date.getMonth() + 1,
    },
  });
  if (period && period.status !== 'OPEN') {
    throw new PeriodClosedError(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
}

export async function createInvoice(tenantId: string, userId: string, userName: string, dto: CreateInvoiceDto, ipAddress?: string) {
  // Idempotency check — scoped to tenant so different tenants can reuse the same client-generated key
  if (dto.idempotencyKey) {
    const existing = await prisma.invoice.findFirst({
      where: { tenantId, idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;
  }

  const customer = await prisma.customer.findFirst({
    where: { id: dto.customerId, tenantId },
  });
  if (!customer) throw new NotFoundError('Customer', dto.customerId);

  const issueDate = new Date();
  await validatePeriodOpen(tenantId, issueDate);

  // Calculate totals
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  const lineItemsWithAmounts = dto.lineItems.map((item, idx) => {
    const lineAmt = new Decimal(item.quantity).times(item.unitPrice).toDecimalPlaces(2);
    const lineTax = lineAmt.times(item.taxRate ?? 0).toDecimalPlaces(2);
    subtotal = subtotal.plus(lineAmt);
    taxAmount = taxAmount.plus(lineTax);
    return { ...item, amount: lineAmt, taxAmount: lineTax, sortOrder: idx };
  });

  const total = subtotal.plus(taxAmount);
  const currency = dto.currency ?? customer.currency;
  const exchangeRate = new Decimal(dto.exchangeRate ?? 1);

  const invoice = await prisma
    .$transaction(async (tx) => {
      const invoiceNumber = await getNextInvoiceNumber(tenantId, tx);

      const inv = await tx.invoice.create({
        data: {
          tenantId,
          entityId: dto.entityId,
          customerId: dto.customerId,
          invoiceNumber,
          status: 'DRAFT',
          issueDate,
          dueDate: new Date(dto.dueDate),
          currency,
          exchangeRate,
          subtotal,
          taxAmount,
          total,
          amountPaid: 0,
          amountDue: total,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy: userId,
          lineItems: {
            create: lineItemsWithAmounts.map((item) => ({
              description: item.description,
              quantity: new Decimal(item.quantity),
              unitPrice: new Decimal(item.unitPrice),
              taxRate: new Decimal(item.taxRate ?? 0),
              amount: item.amount,
              glAccountId: item.glAccountId,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: { lineItems: true, customer: true },
      });

      return inv;
    })
    .catch(async (err: unknown) => {
      // Two concurrent requests with the same idempotency key may both pass the pre-check
      // and race into the transaction. The second will hit the unique constraint (P2002).
      // Recover by returning the record the first request committed, exactly like the
      // pre-check path above.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        dto.idempotencyKey &&
        String(err.meta?.target ?? '').toLowerCase().includes('idempotency')
      ) {
        const existing = await prisma.invoice.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } });
        if (existing) return existing;
      }
      throw err;
    });

  await createAuditLog({
    tenantId,
    entityType: 'Invoice',
    entityId: invoice.id,
    action: 'CREATED',
    userId,
    userName,
    ipAddress,
    newValues: { invoiceNumber: invoice.invoiceNumber, total: total.toFixed(2), status: 'DRAFT' },
  });

  return invoice;
}

export async function getInvoiceById(tenantId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' } },
      customer: true,
      paymentAllocations: {
        include: { payment: { select: { paymentDate: true, method: true, referenceNumber: true } } },
      },
      creditAllocations: {
        include: { creditMemo: { select: { creditMemoNumber: true, reason: true } } },
      },
      journalEntries: {
        include: { lines: { include: { glAccount: true } } },
      },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice', id);
  return invoice;
}

export async function listInvoices(tenantId: string, filters: InvoiceFilterDto) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.InvoiceWhereInput = {
    tenantId,
    ...(filters.entityId && { entityId: filters.entityId }),
    ...(filters.customerId && { customerId: filters.customerId }),
    ...(filters.status && { status: filters.status as InvoiceStatus }),
  };

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { customer: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function approveInvoice(
  tenantId: string,
  id: string,
  userId: string,
  userName: string,
  dto: ApproveInvoiceDto,
  ipAddress?: string
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: { lineItems: true, entity: true },
  });
  if (!invoice) throw new NotFoundError('Invoice', id);

  if (!VALID_TRANSITIONS[invoice.status]?.includes('APPROVED')) {
    throw new InvalidStateTransitionError(invoice.status, 'APPROVED');
  }

  // Validate AR account exists and belongs to this tenant/entity
  const arAccount = await prisma.gLAccount.findFirst({
    where: { id: dto.arAccountId, tenantId, type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
  });
  if (!arAccount) throw new NotFoundError('AR GL Account (must be type ASSET, subtype ACCOUNTS_RECEIVABLE)', dto.arAccountId);

  const postingDate = new Date();
  await validatePeriodOpen(tenantId, postingDate);

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id, tenantId, status: 'DRAFT' },
      data: { status: 'APPROVED', approvedBy: dto.approvedBy ?? userId, approvedAt: postingDate },
    });
    if (count !== 1) throw new InvalidStateTransitionError(invoice.status, 'APPROVED');

    // Generate GL Journal Entry: DR Accounts Receivable / CR Revenue
    const entryNumber = await getNextJournalNumber(tenantId, tx);
    const jeLines: Prisma.JournalEntryLineCreateManyJournalEntryInput[] = [];

    // DR: Accounts Receivable
    jeLines.push({
      glAccountId: arAccount.id,
      debit: invoice.total,
      credit: new Decimal(0),
      description: `AR - Invoice ${invoice.invoiceNumber}`,
      sortOrder: 0,
    });

    // CR: Revenue per line item. Lines without a GL account fall back to the entity's default
    // REVENUE account. If any line is unmapped and no default exists, refuse to post a
    // partial (unbalanced) journal entry.
    const defaultRevenue = await tx.gLAccount.findFirst({
      where: { tenantId, entityId: invoice.entityId, type: 'REVENUE', isActive: true },
      orderBy: { code: 'asc' },
    });

    const revenueByAccount = new Map<string, Decimal>();
    for (const line of invoice.lineItems) {
      const accountId = line.glAccountId ?? defaultRevenue?.id;
      if (!accountId) {
        throw new ValidationError(
          `Line item "${line.description}" has no GL account and no default REVENUE account exists for this entity. ` +
          `Assign a GL account to each line item or create a REVENUE account first.`,
        );
      }
      revenueByAccount.set(accountId, (revenueByAccount.get(accountId) ?? new Decimal(0)).plus(line.amount));
    }

    let idx = 1;
    for (const [accountId, amount] of revenueByAccount) {
      jeLines.push({
        glAccountId: accountId,
        debit: new Decimal(0),
        credit: amount,
        description: `Revenue - Invoice ${invoice.invoiceNumber}`,
        sortOrder: idx++,
      });
    }

    // CR: Tax Payable — refuse to post an unbalanced entry when no account is configured.
    if (new Decimal(invoice.taxAmount.toString()).greaterThan(0)) {
      const taxAccount = await tx.gLAccount.findFirst({
        where: { tenantId, entityId: invoice.entityId, subtype: 'TAX_PAYABLE', isActive: true },
      });
      if (!taxAccount) {
        throw new ValidationError(
          `Invoice has tax of ${invoice.taxAmount} but no TAX_PAYABLE GL account found for entity ${invoice.entityId}. ` +
          `Create a Sales Tax Payable account (type LIABILITY, subtype TAX_PAYABLE) first.`,
        );
      }
      jeLines.push({
        glAccountId: taxAccount.id,
        debit: new Decimal(0),
        credit: invoice.taxAmount,
        description: `Tax Payable - Invoice ${invoice.invoiceNumber}`,
        sortOrder: idx++,
      });
    }

    // Sanity check: entry must balance before we post it.
    const totalCredits = jeLines.slice(1).reduce((s, l) => s.plus(l.credit as Decimal), new Decimal(0));
    if (!totalCredits.equals(new Decimal(invoice.total.toString()))) {
      throw new ValidationError(
        `Journal entry would not balance: DR ${invoice.total}, CR ${totalCredits.toFixed(2)}. Check GL account setup.`,
      );
    }

    const je = await tx.journalEntry.create({
      data: {
        tenantId,
        entityId: invoice.entityId,
        entryNumber,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        invoiceId: invoice.id,
        postingDate,
        period: postingDate.getMonth() + 1,
        fiscalYear: postingDate.getFullYear(),
        status: 'POSTED',
        description: `Invoice approved: ${invoice.invoiceNumber}`,
        totalDebit: invoice.total,
        totalCredit: invoice.total,
        createdBy: userId,
        lines: { createMany: { data: jeLines } },
      },
      include: { lines: { include: { glAccount: true } } },
    });

    return {
      invoice: { ...invoice, status: 'APPROVED' as InvoiceStatus, approvedBy: dto.approvedBy ?? userId, approvedAt: postingDate },
      journalEntry: je,
    };
  });

  await createAuditLog({
    tenantId,
    entityType: 'Invoice',
    entityId: id,
    action: 'APPROVED',
    userId,
    userName,
    ipAddress,
    oldValues: { status: 'DRAFT' },
    newValues: { status: 'APPROVED', journalEntryId: result.journalEntry.id },
  });

  return result;
}

export async function voidInvoice(tenantId: string, id: string, userId: string, userName: string, ipAddress?: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: { journalEntries: { where: { status: 'POSTED' } } },
  });
  if (!invoice) throw new NotFoundError('Invoice', id);

  if (!VALID_TRANSITIONS[invoice.status]?.includes('VOID')) {
    throw new InvalidStateTransitionError(invoice.status, 'VOID');
  }

  if (new Decimal(invoice.amountPaid.toString()).greaterThan(0)) {
    throw new ValidationError('Cannot void an invoice with recorded payments. Reverse payments first.');
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id, tenantId, status: invoice.status },
      data: { status: 'VOID', voidedBy: userId, voidedAt: new Date() },
    });
    if (count !== 1) throw new InvalidStateTransitionError(invoice.status, 'VOID');

    // Reverse any posted GL entries
    for (const je of invoice.journalEntries) {
      await tx.journalEntry.update({ where: { id: je.id }, data: { status: 'REVERSED' } });

      const lines = await tx.journalEntryLine.findMany({ where: { journalEntryId: je.id } });
      const reversalNumber = await getNextJournalNumber(tenantId, tx);

      await tx.journalEntry.create({
        data: {
          tenantId,
          entityId: invoice.entityId,
          entryNumber: reversalNumber,
          referenceType: 'REVERSAL',
          referenceId: invoice.id,
          invoiceId: invoice.id,
          postingDate: new Date(),
          period: new Date().getMonth() + 1,
          fiscalYear: new Date().getFullYear(),
          status: 'POSTED',
          description: `Void reversal: ${invoice.invoiceNumber}`,
          totalDebit: je.totalCredit,
          totalCredit: je.totalDebit,
          reversalOf: je.id,
          createdBy: userId,
          lines: {
            createMany: {
              data: lines.map((l, i) => ({
                glAccountId: l.glAccountId,
                debit: l.credit,
                credit: l.debit,
                description: `Reversal: ${l.description ?? ''}`,
                sortOrder: i,
              })),
            },
          },
        },
      });
    }
  });

  await createAuditLog({
    tenantId,
    entityType: 'Invoice',
    entityId: id,
    action: 'VOIDED',
    userId,
    userName,
    ipAddress,
    oldValues: { status: invoice.status },
    newValues: { status: 'VOID' },
  });
}

export async function markInvoiceSent(tenantId: string, id: string, userId: string, userName: string, ipAddress?: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw new NotFoundError('Invoice', id);

  if (!VALID_TRANSITIONS[invoice.status]?.includes('SENT')) {
    throw new InvalidStateTransitionError(invoice.status, 'SENT');
  }

  const { count } = await prisma.invoice.updateMany({
    where: { id, tenantId, status: invoice.status },
    data: { status: 'SENT' },
  });
  if (count !== 1) throw new InvalidStateTransitionError(invoice.status, 'SENT');
  const updated = { ...invoice, status: 'SENT' as InvoiceStatus };

  await createAuditLog({
    tenantId, entityType: 'Invoice', entityId: id, action: 'SENT',
    userId, userName, ipAddress, oldValues: { status: invoice.status }, newValues: { status: 'SENT' },
  });

  return updated;
}

export async function writeOffInvoice(
  tenantId: string,
  id: string,
  userId: string,
  userName: string,
  badDebtAccountId: string,
  ipAddress?: string
) {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw new NotFoundError('Invoice', id);

  if (!VALID_TRANSITIONS[invoice.status]?.includes('WRITTEN_OFF')) {
    throw new InvalidStateTransitionError(invoice.status, 'WRITTEN_OFF');
  }

  const badDebtAccount = await prisma.gLAccount.findFirst({
    where: { id: badDebtAccountId, tenantId, type: 'EXPENSE' },
  });
  if (!badDebtAccount) throw new NotFoundError('Bad Debt Expense GL Account', badDebtAccountId);

  const arAccount = await prisma.gLAccount.findFirst({
    where: { tenantId, entityId: invoice.entityId, subtype: 'ACCOUNTS_RECEIVABLE', isActive: true },
  });

  const writeOffAmount = new Decimal(invoice.amountDue.toString());

  if (writeOffAmount.greaterThan(0) && !arAccount) {
    throw new ValidationError(
      `Cannot write off invoice ${invoice.invoiceNumber}: no ACCOUNTS_RECEIVABLE GL account found ` +
      `for entity ${invoice.entityId}. Create an AR account (type ASSET, subtype ACCOUNTS_RECEIVABLE) first.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id, tenantId, status: invoice.status },
      data: { status: 'WRITTEN_OFF', amountDue: new Decimal(0) },
    });
    if (count !== 1) throw new InvalidStateTransitionError(invoice.status, 'WRITTEN_OFF');

    if (arAccount && writeOffAmount.greaterThan(0)) {
      const entryNumber = await getNextJournalNumber(tenantId, tx);
      await tx.journalEntry.create({
        data: {
          tenantId,
          entityId: invoice.entityId,
          entryNumber,
          referenceType: 'WRITE_OFF',
          referenceId: invoice.id,
          invoiceId: invoice.id,
          postingDate: new Date(),
          period: new Date().getMonth() + 1,
          fiscalYear: new Date().getFullYear(),
          status: 'POSTED',
          description: `Write-off: ${invoice.invoiceNumber}`,
          totalDebit: writeOffAmount,
          totalCredit: writeOffAmount,
          createdBy: userId,
          lines: {
            createMany: {
              data: [
                { glAccountId: badDebtAccount.id, debit: writeOffAmount, credit: new Decimal(0), description: 'Bad debt expense', sortOrder: 0 },
                { glAccountId: arAccount.id, debit: new Decimal(0), credit: writeOffAmount, description: 'AR cleared - write-off', sortOrder: 1 },
              ],
            },
          },
        },
      });
    }
  });

  await createAuditLog({
    tenantId, entityType: 'Invoice', entityId: id, action: 'WRITTEN_OFF',
    userId, userName, ipAddress, oldValues: { status: invoice.status, amountDue: invoice.amountDue.toString() },
    newValues: { status: 'WRITTEN_OFF', writeOffAmount: writeOffAmount.toFixed(2) },
  });
}

async function getNextJournalNumber(
  tenantId: string,
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
): Promise<string> {
  const n = await getNextSequence(tenantId, 'JE', tx);
  return `JE-${String(n).padStart(6, '0')}`;
}

export { getNextJournalNumber };
