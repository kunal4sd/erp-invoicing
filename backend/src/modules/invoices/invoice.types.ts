export interface CreateInvoiceDto {
  entityId: string;
  customerId: string;
  dueDate: string;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
  idempotencyKey?: string;
  lineItems: LineItemDto[];
}

export interface LineItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  glAccountId?: string;
}

export interface ApproveInvoiceDto {
  arAccountId: string;
  approvedBy?: string;
}

export interface InvoiceFilterDto {
  entityId?: string;
  customerId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

// Valid state transitions map
export const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['APPROVED', 'VOID'],
  APPROVED: ['SENT', 'VOID'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'VOID', 'WRITTEN_OFF'],
  PARTIALLY_PAID: ['PAID', 'VOID', 'WRITTEN_OFF'],
  PAID: [],
  VOID: [],
  WRITTEN_OFF: [],
};

export const EDITABLE_STATES = new Set(['DRAFT']);
export const PAYABLE_STATES = new Set(['APPROVED', 'SENT', 'PARTIALLY_PAID']);
