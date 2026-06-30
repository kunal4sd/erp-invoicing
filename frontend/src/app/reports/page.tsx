'use client';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../lib/api';
import { useTenant } from '../../components/TenantProvider';

export default function ReportsPage() {
  const { tenantId } = useTenant();
  const { data: aging, isLoading } = useQuery({
    queryKey: ['ar-aging', tenantId],
    queryFn: () => reportsApi.arAging().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const fmt = (v: string) =>
    `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const cols = ['Customer', 'Current', '1–30 Days', '31–60 Days', '61–90 Days', '90+ Days', 'Total'];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">AR Aging Report</h1>
      <p className="text-gray-500 text-sm mb-6">As of {aging?.asOfDate ?? '–'}</p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {cols.map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {aging?.rows?.map((row: any) => (
              <tr key={row.customerId} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{row.customerName}</td>
                <td className="px-4 py-3 font-mono text-green-700">{fmt(row.current)}</td>
                <td className="px-4 py-3 font-mono text-yellow-700">{fmt(row.days_1_30)}</td>
                <td className="px-4 py-3 font-mono text-orange-600">{fmt(row.days_31_60)}</td>
                <td className="px-4 py-3 font-mono text-red-500">{fmt(row.days_61_90)}</td>
                <td className="px-4 py-3 font-mono text-red-700 font-semibold">{fmt(row.days_over_90)}</td>
                <td className="px-4 py-3 font-mono font-bold">{fmt(row.total)}</td>
              </tr>
            ))}
            {aging?.totals && (
              <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                <td className="px-4 py-3">Totals</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.current)}</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.days_1_30)}</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.days_31_60)}</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.days_61_90)}</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.days_over_90)}</td>
                <td className="px-4 py-3 font-mono">{fmt(aging.totals.total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
