import { prisma } from '../../config/database';
import { NotFoundError, ConflictError } from '../../shared/errors';

export interface CreateCustomerDto {
  entityId: string;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  currency?: string;
  creditLimit?: number;
  paymentTerms?: number;
  arAccountId?: string;
}

export async function createCustomer(tenantId: string, dto: CreateCustomerDto) {
  const existing = await prisma.customer.findFirst({
    where: { tenantId, entityId: dto.entityId, code: dto.code },
  });
  if (existing) throw new ConflictError(`Customer code '${dto.code}' already exists`);

  return prisma.customer.create({
    data: {
      tenantId,
      entityId: dto.entityId,
      code: dto.code,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      currency: dto.currency ?? 'USD',
      creditLimit: dto.creditLimit ?? 0,
      paymentTerms: dto.paymentTerms ?? 30,
      arAccountId: dto.arAccountId,
    },
  });
}

export async function listCustomers(tenantId: string, entityId?: string) {
  return prisma.customer.findMany({
    where: { tenantId, ...(entityId && { entityId }), isActive: true },
    orderBy: { name: 'asc' },
  });
}

export async function getCustomerById(tenantId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      invoices: {
        where: { status: { notIn: ['VOID'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, invoiceNumber: true, total: true, amountDue: true, status: true, dueDate: true },
      },
    },
  });
  if (!customer) throw new NotFoundError('Customer', id);
  return customer;
}

export async function getCustomerAgingReport(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw new NotFoundError('Customer', customerId);

  const today = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      customerId,
      status: { in: ['APPROVED', 'SENT', 'PARTIALLY_PAID'] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      amountDue: true,
      dueDate: true,
      issueDate: true,
      status: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  type AgingBucket = {
    invoiceId: string;
    invoiceNumber: string;
    total: string;
    amountDue: string;
    dueDate: Date;
    daysOverdue: number;
  };

  const buckets = {
    current: [] as AgingBucket[],
    days_1_30: [] as AgingBucket[],
    days_31_60: [] as AgingBucket[],
    days_61_90: [] as AgingBucket[],
    days_over_90: [] as AgingBucket[],
  };

  for (const inv of invoices) {
    const daysOverdue = Math.floor(
      (today.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    const entry: AgingBucket = {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      total: inv.total.toString(),
      amountDue: inv.amountDue.toString(),
      dueDate: inv.dueDate,
      daysOverdue,
    };

    if (daysOverdue <= 0) buckets.current.push(entry);
    else if (daysOverdue <= 30) buckets.days_1_30.push(entry);
    else if (daysOverdue <= 60) buckets.days_31_60.push(entry);
    else if (daysOverdue <= 90) buckets.days_61_90.push(entry);
    else buckets.days_over_90.push(entry);
  }

  const sumBucket = (b: AgingBucket[]) =>
    b.reduce((s, i) => s + parseFloat(i.amountDue), 0).toFixed(2);

  return {
    customerId,
    customerName: customer.name,
    currency: customer.currency,
    asOfDate: today.toISOString().split('T')[0],
    summary: {
      current: sumBucket(buckets.current),
      days_1_30: sumBucket(buckets.days_1_30),
      days_31_60: sumBucket(buckets.days_31_60),
      days_61_90: sumBucket(buckets.days_61_90),
      days_over_90: sumBucket(buckets.days_over_90),
      total: invoices.reduce((s, i) => s + parseFloat(i.amountDue.toString()), 0).toFixed(2),
    },
    detail: buckets,
  };
}
