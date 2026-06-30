import Decimal from 'decimal.js';
import { prisma } from '../../config/database';
import { createAuditLog } from '../../middleware/audit';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors';
import { getNextJournalNumber, getNextSequence } from '../invoices/invoice.service';

export interface CreateCreditMemoDto {
  entityId: string;
  customerId: string;
  originalInvoiceId?: string;
  amount: number;
  currency?: string;
  reason: string;
}

export interface ApplyCreditMemoDto {
  invoiceId: string;
  amount: number;
  arAccountId: string;
  revenueAccountId: string;
}

export async function createCreditMemo(tenantId: string, userId: string, userName: string, dto: CreateCreditMemoDto, ipAddress?: string) {
  const customer = await prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
  if (!customer) throw new NotFoundError('Customer', dto.customerId);

  if (dto.originalInvoiceId) {
    const invoice = await prisma.invoice.findFirst({ where: { id: dto.originalInvoiceId, tenantId } });
    if (!invoice) throw new NotFoundError('Invoice', dto.originalInvoiceId);
    if (!['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
      throw new ValidationError('Credit memo can only reference an approved, sent, or paid invoice');
    }
  }

  const amount = new Decimal(dto.amount);

  const cm = await prisma.$transaction(async (tx) => {
    const n = await getNextSequence(tenantId, 'CM', tx as any);
    const creditMemoNumber = `CM-${String(n).padStart(6, '0')}`;
    return tx.creditMemo.create({
      data: {
        tenantId,
        entityId: dto.entityId,
        customerId: dto.customerId,
        creditMemoNumber,
        originalInvoiceId: dto.originalInvoiceId,
        amount,
        remainingAmount: amount,
        currency: dto.currency ?? customer.currency,
        reason: dto.reason,
        status: 'APPROVED',
        createdBy: userId,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
  });

  await createAuditLog({
    tenantId, entityType: 'CreditMemo', entityId: cm.id, action: 'CREATED',
    userId, userName, ipAddress, newValues: { creditMemoNumber: cm.creditMemoNumber, amount: amount.toFixed(2) },
  });

  return cm;
}

export async function applyCreditMemo(
  tenantId: string,
  creditMemoId: string,
  userId: string,
  userName: string,
  dto: ApplyCreditMemoDto,
  ipAddress?: string
) {
  const cm = await prisma.creditMemo.findFirst({
    where: { id: creditMemoId, tenantId },
  });
  if (!cm) throw new NotFoundError('Credit Memo', creditMemoId);
  if (cm.status === 'VOID') throw new ValidationError('Cannot apply a voided credit memo');
  if (cm.status === 'APPLIED') throw new ValidationError('Credit memo is fully applied');

  const invoice = await prisma.invoice.findFirst({
    where: { id: dto.invoiceId, tenantId, customerId: cm.customerId },
  });
  if (!invoice) throw new NotFoundError('Invoice', dto.invoiceId);

  const applyAmount = new Decimal(dto.amount);
  const remaining = new Decimal(cm.remainingAmount.toString());

  if (applyAmount.greaterThan(remaining.plus(0.01))) {
    throw new ValidationError(`Apply amount ${applyAmount} exceeds credit memo remaining balance ${remaining}`);
  }
  if (applyAmount.greaterThan(new Decimal(invoice.amountDue.toString()).plus(0.01))) {
    throw new ValidationError(`Apply amount ${applyAmount} exceeds invoice balance ${invoice.amountDue}`);
  }

  const arAccount = await prisma.gLAccount.findFirst({ where: { id: dto.arAccountId, tenantId, type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' } });
  if (!arAccount) throw new NotFoundError('AR Account (must be type ASSET, subtype ACCOUNTS_RECEIVABLE)', dto.arAccountId);

  const revAccount = await prisma.gLAccount.findFirst({ where: { id: dto.revenueAccountId, tenantId } });
  if (!revAccount) throw new NotFoundError('Revenue Account', dto.revenueAccountId);

  await prisma.$transaction(async (tx) => {
    // Lock both rows before reading mutable fields. Two concurrent applies would otherwise
    // both pass the pre-transaction validation and over-apply the credit memo or invoice.
    // This mirrors the SELECT FOR UPDATE pattern used in payment.service.ts.
    const cmRows = await tx.$queryRaw<Array<{
      id: string; remainingAmount: unknown; appliedAmount: unknown; status: string;
    }>>`
      SELECT id, "remainingAmount", "appliedAmount", status
      FROM "CreditMemo"
      WHERE id = ${creditMemoId} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (!cmRows.length) throw new NotFoundError('Credit Memo', creditMemoId);
    const lockedCm = cmRows[0];

    const invRows = await tx.$queryRaw<Array<{
      id: string; amountPaid: unknown; amountDue: unknown; total: unknown; status: string;
    }>>`
      SELECT id, "amountPaid", "amountDue", total, status
      FROM "Invoice"
      WHERE id = ${dto.invoiceId} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (!invRows.length) throw new NotFoundError('Invoice', dto.invoiceId);
    const lockedInv = invRows[0];

    const lockedRemaining = new Decimal(String(lockedCm.remainingAmount));
    const lockedApplied = new Decimal(String(lockedCm.appliedAmount));
    const lockedAmountPaid = new Decimal(String(lockedInv.amountPaid));
    const lockedAmountDue = new Decimal(String(lockedInv.amountDue));
    const lockedTotal = new Decimal(String(lockedInv.total));

    // Re-validate inside the lock — a concurrent apply may have already reduced these values.
    if (applyAmount.greaterThan(lockedRemaining.plus(new Decimal('0.01')))) {
      throw new ValidationError(
        `Credit memo remaining balance ($${lockedRemaining.toFixed(2)}) is insufficient for $${applyAmount.toFixed(2)}. ` +
        `A concurrent application may have reduced the balance — please retry.`,
      );
    }
    if (applyAmount.greaterThan(lockedAmountDue.plus(new Decimal('0.01')))) {
      throw new ValidationError(
        `Invoice balance ($${lockedAmountDue.toFixed(2)}) is insufficient for $${applyAmount.toFixed(2)}. ` +
        `A concurrent payment may have reduced the balance — please retry.`,
      );
    }

    const newRemaining = lockedRemaining.minus(applyAmount);
    const newApplied = lockedApplied.plus(applyAmount);
    const newCmStatus = newRemaining.lessThanOrEqualTo(0.001) ? 'APPLIED' : 'PARTIALLY_APPLIED';

    await tx.creditMemo.update({
      where: { id: creditMemoId },
      data: { remainingAmount: newRemaining, appliedAmount: newApplied, status: newCmStatus },
    });

    // Check for existing allocation between this CM and invoice
    const existingAlloc = await tx.creditMemoAllocation.findUnique({
      where: { creditMemoId_invoiceId: { creditMemoId, invoiceId: dto.invoiceId } },
    });

    if (existingAlloc) {
      await tx.creditMemoAllocation.update({
        where: { creditMemoId_invoiceId: { creditMemoId, invoiceId: dto.invoiceId } },
        data: { amount: new Decimal(existingAlloc.amount.toString()).plus(applyAmount) },
      });
    } else {
      await tx.creditMemoAllocation.create({
        data: { creditMemoId, invoiceId: dto.invoiceId, amount: applyAmount, appliedBy: userId },
      });
    }

    const newInvoicePaid = lockedAmountPaid.plus(applyAmount);
    const newInvoiceDue = lockedTotal.minus(newInvoicePaid);
    const newInvoiceStatus = newInvoiceDue.lessThanOrEqualTo(0.001) ? 'PAID' : 'PARTIALLY_PAID';

    await tx.invoice.update({
      where: { id: dto.invoiceId },
      data: { amountPaid: newInvoicePaid, amountDue: Decimal.max(newInvoiceDue, 0), status: newInvoiceStatus },
    });

    // GL: DR Revenue / CR AR
    const entryNumber = await getNextJournalNumber(tenantId, tx as any);
    await tx.journalEntry.create({
      data: {
        tenantId, entityId: invoice.entityId, entryNumber,
        referenceType: 'CREDIT_MEMO', referenceId: creditMemoId,
        invoiceId: dto.invoiceId,
        postingDate: new Date(),
        period: new Date().getMonth() + 1,
        fiscalYear: new Date().getFullYear(),
        status: 'POSTED',
        description: `Credit memo ${cm.creditMemoNumber} applied to ${invoice.invoiceNumber}`,
        totalDebit: applyAmount, totalCredit: applyAmount,
        createdBy: userId,
        lines: {
          createMany: {
            data: [
              { glAccountId: revAccount.id, debit: applyAmount, credit: new Decimal(0), description: 'Revenue reduction (credit memo)', sortOrder: 0 },
              { glAccountId: arAccount.id, debit: new Decimal(0), credit: applyAmount, description: 'AR reduction (credit memo)', sortOrder: 1 },
            ],
          },
        },
      },
    });
  });

  await createAuditLog({
    tenantId, entityType: 'CreditMemo', entityId: creditMemoId, action: 'APPLIED',
    userId, userName, ipAddress, newValues: { invoiceId: dto.invoiceId, amount: applyAmount.toFixed(2) },
  });

  return prisma.creditMemo.findUnique({ where: { id: creditMemoId }, include: { allocations: true } });
}

export async function listCreditMemos(tenantId: string, customerId?: string) {
  return prisma.creditMemo.findMany({
    where: { tenantId, ...(customerId && { customerId }) },
    include: { allocations: { include: { invoice: { select: { invoiceNumber: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}
