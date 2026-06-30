'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { invoicesApi } from '../../lib/api';
import { useTenant } from '../../components/TenantProvider';
import { format } from 'date-fns';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge-${status.toLowerCase()}`}>{status.replace('_', ' ')}</span>;
}

export default function InvoicesPage() {
  const { tenantId, userRole } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', tenantId],
    queryFn: () => invoicesApi.list().then((r) => r.data),
    enabled: !!tenantId,
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-gray-500 text-sm mt-0.5">{data?.total ?? 0} total invoices</p>
        </div>
        {userRole !== 'VIEWER' ? (
          <Link href="/invoices/new" className="btn-primary">+ New Invoice</Link>
        ) : (
          <span className="text-xs text-gray-400 italic">Read-only (VIEWER)</span>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Total', 'Balance', 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {data?.items?.map((inv: any) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/invoices/${inv.id}`} className="text-brand-600 font-medium hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-700">{inv.customer?.name}</td>
                <td className="px-4 py-3 text-gray-500">{format(new Date(inv.issueDate), 'MMM d, yyyy')}</td>
                <td className="px-4 py-3 text-gray-500">{format(new Date(inv.dueDate), 'MMM d, yyyy')}</td>
                <td className="px-4 py-3 font-mono">{fmt(inv.total)}</td>
                <td className="px-4 py-3 font-mono">{fmt(inv.amountDue)}</td>
                <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
