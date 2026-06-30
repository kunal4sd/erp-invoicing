const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'badge-draft',
  APPROVED: 'badge-approved',
  SENT: 'badge-sent',
  PARTIALLY_PAID: 'badge-partially_paid',
  PAID: 'badge-paid',
  VOID: 'badge-void',
  WRITTEN_OFF: 'badge-written_off',
  PARTIALLY_APPLIED: 'badge-partially_paid',
  APPLIED: 'badge-paid',
  PENDING: 'badge-sent',
  UNAPPLIED: 'badge-draft',
  VOIDED: 'badge-void',
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ');
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'badge-draft';
  return <span className={style}>{formatStatus(status)}</span>;
}
