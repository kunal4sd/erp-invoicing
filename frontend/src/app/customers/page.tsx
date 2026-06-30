'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { customersApi } from '../../lib/api';
import { useTenant } from '../../components/TenantProvider';

export default function CustomersPage() {
  const { tenantId } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => customersApi.list().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Code', 'Name', 'Email', 'Currency', 'Credit Limit', 'Terms', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {data?.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-gray-500">{c.code}</td>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-gray-500">{c.email ?? '–'}</td>
                <td className="px-4 py-3">{c.currency}</td>
                <td className="px-4 py-3 font-mono">{fmt(c.creditLimit)}</td>
                <td className="px-4 py-3">Net {c.paymentTerms}</td>
                <td className="px-4 py-3">
                  <Link href={`/customers/${c.id}/aging`} className="text-brand-600 text-xs hover:underline mr-2">
                    Aging
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
