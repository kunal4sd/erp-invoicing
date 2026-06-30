'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { invoicesApi } from '../../lib/api';
import { useTenant } from '../../components/TenantProvider';
import { StatusBadge } from '../../components/StatusBadge';
import { format, isPast, startOfDay } from 'date-fns';

export default function InvoicesPage() {
  const { tenantId, userRole } = useTenant();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', tenantId],
    queryFn: () => invoicesApi.list().then((r) => r.data),
    enabled: !!tenantId,
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const isOverdue = (dueDate: string, status: string, amountDue: string) => {
    const open = ['SENT', 'PARTIALLY_PAID', 'APPROVED'].includes(status);
    return open && parseFloat(amountDue) > 0 && isPast(startOfDay(new Date(dueDate)));
  };

  return (
    <div className="page-shell">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{data?.total ?? 0} total invoices</p>
        </div>
        {userRole !== 'VIEWER' ? (
          <Link href="/invoices/new" className="btn-primary">+ New Invoice</Link>
        ) : (
          <span className="role-pill">Read-only (VIEWER)</span>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="py-10 text-center cell-muted">Loading invoices…</td></tr>
              )}
              {!isLoading && (!data?.items || data.items.length === 0) && (
                <tr><td colSpan={7} className="py-10 text-center cell-muted">No invoices found</td></tr>
              )}
              {data?.items?.map((inv: {
                id: string;
                invoiceNumber: string;
                issueDate: string;
                dueDate: string;
                total: string;
                amountDue: string;
                status: string;
                customer?: { name: string };
              }) => {
                const overdue = isOverdue(inv.dueDate, inv.status, inv.amountDue);
                const hasBalance = parseFloat(inv.amountDue) > 0;

                return (
                  <tr
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                  >
                    <td>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="cell-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="font-medium text-slate-800 dark:text-slate-200">{inv.customer?.name}</td>
                    <td className="cell-muted whitespace-nowrap">{format(new Date(inv.issueDate), 'MMM d, yyyy')}</td>
                    <td className={`whitespace-nowrap ${overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'cell-muted'}`}>
                      {format(new Date(inv.dueDate), 'MMM d, yyyy')}
                      {overdue && <span className="ml-1.5 text-[10px] uppercase tracking-wide">Overdue</span>}
                    </td>
                    <td className="text-right cell-mono font-semibold">{fmt(inv.total)}</td>
                    <td className={`text-right cell-mono ${hasBalance ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                      {fmt(inv.amountDue)}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex justify-end">
                        <StatusBadge status={inv.status} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
