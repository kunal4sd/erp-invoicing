'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { customersApi } from '../../../../lib/api';
import { useTenant } from '../../../../components/TenantProvider';
import { format } from 'date-fns';

export default function CustomerAgingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenantId } = useTenant();

  const { data: aging, isLoading } = useQuery({
    queryKey: ['customer-aging', tenantId, id],
    queryFn: () => customersApi.aging(id).then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const fmt = (v: string) => `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const buckets = [
    { key: 'current', label: 'Current', color: 'text-green-700' },
    { key: 'days_1_30', label: '1–30 Days', color: 'text-yellow-600' },
    { key: 'days_31_60', label: '31–60 Days', color: 'text-orange-600' },
    { key: 'days_61_90', label: '61–90 Days', color: 'text-red-500' },
    { key: 'days_over_90', label: '90+ Days', color: 'text-red-700 font-bold' },
  ] as const;

  return (
    <div className="p-8 max-w-4xl">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-800 mb-4">← Back</button>
      <h1 className="text-2xl font-bold mb-1">AR Aging — {aging?.customerName ?? '…'}</h1>
      <p className="text-gray-500 text-sm mb-6">As of {aging?.asOfDate ?? '–'} · {aging?.currency}</p>

      {isLoading && <p className="text-gray-400">Loading…</p>}

      {aging && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-5 gap-3 mb-8">
            {buckets.map((b) => (
              <div key={b.key} className="card p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">{b.label}</p>
                <p className={`font-mono text-base font-semibold ${b.color}`}>
                  {fmt(aging.summary[b.key])}
                </p>
              </div>
            ))}
          </div>
          <div className="card p-4 mb-8 flex items-center justify-between">
            <p className="text-sm text-gray-500">Total Outstanding</p>
            <p className="text-xl font-bold font-mono">{fmt(aging.summary.total)}</p>
          </div>

          {/* Detail tables per bucket */}
          {buckets.map((b) => {
            const invoices = aging.detail[b.key];
            if (!invoices || invoices.length === 0) return null;
            return (
              <div key={b.key} className="card overflow-hidden mb-4">
                <div className={`px-4 py-2 border-b border-gray-100 font-medium text-sm ${b.color}`}>
                  {b.label} — {invoices.length} invoice{invoices.length > 1 ? 's' : ''}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Invoice #', 'Due Date', 'Days Overdue', 'Total', 'Balance Due'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoices.map((inv: any) => (
                      <tr key={inv.invoiceId}>
                        <td className="px-4 py-2 font-medium">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2 text-gray-500">{format(new Date(inv.dueDate), 'MMM d, yyyy')}</td>
                        <td className={`px-4 py-2 ${inv.daysOverdue > 0 ? 'text-red-600 font-medium' : 'text-green-600'}`}>
                          {inv.daysOverdue > 0 ? `${inv.daysOverdue} days` : 'Not due'}
                        </td>
                        <td className="px-4 py-2 font-mono">{fmt(inv.total)}</td>
                        <td className="px-4 py-2 font-mono font-semibold">{fmt(inv.amountDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
