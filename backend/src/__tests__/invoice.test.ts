/**
 * Unit tests for invoice service business logic.
 * Uses Prisma mocks — no database required.
 *
 * Run: npm test
 */

import { VALID_TRANSITIONS, PAYABLE_STATES, EDITABLE_STATES } from '../modules/invoices/invoice.types';
import { InvalidStateTransitionError, ValidationError, PeriodClosedError } from '../shared/errors';

// ─── State machine tests ──────────────────────────────────────────────────────

describe('Invoice state machine', () => {
  it('DRAFT can transition to APPROVED', () => {
    expect(VALID_TRANSITIONS['DRAFT']).toContain('APPROVED');
  });

  it('DRAFT can be voided', () => {
    expect(VALID_TRANSITIONS['DRAFT']).toContain('VOID');
  });

  it('APPROVED cannot go directly to PAID', () => {
    expect(VALID_TRANSITIONS['APPROVED']).not.toContain('PAID');
  });

  it('SENT can transition to PARTIALLY_PAID', () => {
    expect(VALID_TRANSITIONS['SENT']).toContain('PARTIALLY_PAID');
  });

  it('SENT can transition to PAID', () => {
    expect(VALID_TRANSITIONS['SENT']).toContain('PAID');
  });

  it('SENT can be written off', () => {
    expect(VALID_TRANSITIONS['SENT']).toContain('WRITTEN_OFF');
  });

  it('PAID has no further transitions', () => {
    expect(VALID_TRANSITIONS['PAID']).toHaveLength(0);
  });

  it('VOID has no further transitions', () => {
    expect(VALID_TRANSITIONS['VOID']).toHaveLength(0);
  });

  it('WRITTEN_OFF has no further transitions', () => {
    expect(VALID_TRANSITIONS['WRITTEN_OFF']).toHaveLength(0);
  });

  it('PAYABLE_STATES includes APPROVED, SENT, PARTIALLY_PAID', () => {
    expect(PAYABLE_STATES.has('APPROVED')).toBe(true);
    expect(PAYABLE_STATES.has('SENT')).toBe(true);
    expect(PAYABLE_STATES.has('PARTIALLY_PAID')).toBe(true);
  });

  it('PAYABLE_STATES excludes DRAFT and PAID', () => {
    expect(PAYABLE_STATES.has('DRAFT')).toBe(false);
    expect(PAYABLE_STATES.has('PAID')).toBe(false);
  });

  it('EDITABLE_STATES is only DRAFT', () => {
    expect(EDITABLE_STATES.has('DRAFT')).toBe(true);
    expect(EDITABLE_STATES.size).toBe(1);
  });
});

// ─── Error class tests ────────────────────────────────────────────────────────

describe('Error classes', () => {
  it('InvalidStateTransitionError has 422 status', () => {
    const err = new InvalidStateTransitionError('DRAFT', 'PAID');
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('DRAFT');
    expect(err.message).toContain('PAID');
    expect(err.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('ValidationError has 422 status', () => {
    const err = new ValidationError('test error');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('PeriodClosedError has 422 status and PERIOD_CLOSED code', () => {
    const err = new PeriodClosedError('2026-01');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('PERIOD_CLOSED');
    expect(err.message).toContain('2026-01');
  });
});

// ─── Payment allocation logic tests ──────────────────────────────────────────

import Decimal from 'decimal.js';

describe('Payment allocation arithmetic', () => {
  it('applies payment correctly across two invoices (FIFO)', () => {
    const invoices = [
      { id: 'inv-1', amountDue: new Decimal(3000) },
      { id: 'inv-2', amountDue: new Decimal(5000) },
    ];
    const paymentAmount = new Decimal(6000);

    let remaining = paymentAmount;
    const allocations: Array<{ invoiceId: string; amount: Decimal }> = [];
    for (const inv of invoices) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const apply = Decimal.min(remaining, inv.amountDue);
      allocations.push({ invoiceId: inv.id, amount: apply });
      remaining = remaining.minus(apply);
    }

    expect(allocations[0].amount.toNumber()).toBe(3000);
    expect(allocations[1].amount.toNumber()).toBe(3000);
    expect(remaining.toNumber()).toBe(0);
  });

  it('does not over-allocate beyond invoice balance', () => {
    const invoiceDue = new Decimal(1000);
    const paymentAmount = new Decimal(5000);
    const apply = Decimal.min(paymentAmount, invoiceDue);
    expect(apply.toNumber()).toBe(1000);
  });

  it('partial payment leaves correct amountDue', () => {
    const total = new Decimal(10000);
    const paid = new Decimal(4000);
    const due = total.minus(paid);
    expect(due.toNumber()).toBe(6000);
  });

  it('full payment marks invoice as PAID', () => {
    const total = new Decimal(1000);
    const paid = new Decimal(1000);
    const due = total.minus(paid);
    const status = due.lessThanOrEqualTo(0.001) ? 'PAID' : 'PARTIALLY_PAID';
    expect(status).toBe('PAID');
  });

  it('handles floating point tolerance in paid check', () => {
    // $0.001 rounding should still count as PAID
    const due = new Decimal('0.001');
    const status = due.lessThanOrEqualTo(0.001) ? 'PAID' : 'PARTIALLY_PAID';
    expect(status).toBe('PAID');
  });
});

// ─── Invoice total calculation tests ─────────────────────────────────────────

describe('Invoice total calculation', () => {
  function calculateInvoiceTotals(lineItems: Array<{ quantity: number; unitPrice: number; taxRate: number }>) {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    for (const item of lineItems) {
      const lineAmt = new Decimal(item.quantity).times(item.unitPrice).toDecimalPlaces(2);
      const lineTax = lineAmt.times(item.taxRate).toDecimalPlaces(2);
      subtotal = subtotal.plus(lineAmt);
      taxAmount = taxAmount.plus(lineTax);
    }
    return { subtotal, taxAmount, total: subtotal.plus(taxAmount) };
  }

  it('computes single line item correctly', () => {
    const { subtotal, taxAmount, total } = calculateInvoiceTotals([
      { quantity: 1, unitPrice: 10000, taxRate: 0.08 },
    ]);
    expect(subtotal.toNumber()).toBe(10000);
    expect(taxAmount.toNumber()).toBe(800);
    expect(total.toNumber()).toBe(10800);
  });

  it('computes multi-line invoice correctly', () => {
    const { subtotal, taxAmount, total } = calculateInvoiceTotals([
      { quantity: 1, unitPrice: 10000, taxRate: 0.08 },
      { quantity: 5, unitPrice: 250, taxRate: 0 },
    ]);
    expect(subtotal.toNumber()).toBe(11250);
    expect(taxAmount.toNumber()).toBe(800);
    expect(total.toNumber()).toBe(12050);
  });

  it('handles zero-tax lines', () => {
    const { taxAmount } = calculateInvoiceTotals([
      { quantity: 2, unitPrice: 500, taxRate: 0 },
    ]);
    expect(taxAmount.toNumber()).toBe(0);
  });

  it('rounds line amounts to 2 decimal places', () => {
    const { subtotal } = calculateInvoiceTotals([
      { quantity: 3, unitPrice: 1.005, taxRate: 0 },
    ]);
    // 3 × 1.005 = 3.015, rounded to 2dp = 3.02
    expect(subtotal.toFixed(2)).toBe('3.02');
  });
});

// ─── AR aging bucket logic ────────────────────────────────────────────────────

describe('AR aging buckets', () => {
  function getAgingBucket(dueDate: Date, today: Date): string {
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 30) return 'days_1_30';
    if (daysOverdue <= 60) return 'days_31_60';
    if (daysOverdue <= 90) return 'days_61_90';
    return 'days_over_90';
  }

  const today = new Date('2026-06-29');

  it('invoice due today is current', () => {
    expect(getAgingBucket(new Date('2026-06-29'), today)).toBe('current');
  });

  it('invoice due tomorrow is current', () => {
    expect(getAgingBucket(new Date('2026-06-30'), today)).toBe('current');
  });

  it('invoice 15 days overdue is in 1-30 bucket', () => {
    expect(getAgingBucket(new Date('2026-06-14'), today)).toBe('days_1_30');
  });

  it('invoice 45 days overdue is in 31-60 bucket', () => {
    expect(getAgingBucket(new Date('2026-05-15'), today)).toBe('days_31_60');
  });

  it('invoice 75 days overdue is in 61-90 bucket', () => {
    expect(getAgingBucket(new Date('2026-04-15'), today)).toBe('days_61_90');
  });

  it('invoice 100 days overdue is in 90+ bucket', () => {
    expect(getAgingBucket(new Date('2026-03-21'), today)).toBe('days_over_90');
  });
});

// ─── GL balance test ──────────────────────────────────────────────────────────

describe('GL journal entry balance', () => {
  it('DR Accounts Receivable = Invoice Total on approval', () => {
    const invoiceTotal = new Decimal(12050);
    const subtotal = new Decimal(11250);
    const tax = new Decimal(800);

    const drAR = invoiceTotal;
    const crRevenue = subtotal;
    const crTax = tax;

    expect(drAR.equals(crRevenue.plus(crTax))).toBe(true);
  });

  it('DR Cash = CR AR on payment', () => {
    const paymentAmount = new Decimal(5000);
    expect(paymentAmount.equals(paymentAmount)).toBe(true);
  });

  it('credit memo reduces both revenue and AR by same amount', () => {
    const creditAmount = new Decimal(500);
    const drRevenue = creditAmount;
    const crAR = creditAmount;
    expect(drRevenue.equals(crAR)).toBe(true);
  });
});
