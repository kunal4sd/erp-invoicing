'use client';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../lib/api';
import { useTenant } from '../components/TenantProvider';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { tenantId } = useTenant();

  const { data: summary } = useQuery({
    queryKey: ['ar-summary', tenantId],
    queryFn: () => reportsApi.arSummary().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: recon } = useQuery({
    queryKey: ['gl-reconciliation', tenantId],
    queryFn: () => reportsApi.glReconciliation().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const fmt = (v?: string) =>
    v ? `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '–';

  if (!tenantId) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
        Connecting to API…
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Accounts Receivable Dashboard</h1>
        <p className="text-gray-500 mt-1">Real-time AR overview with GL reconciliation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          label="Total Billed (Open)"
          value={fmt(summary?.totalBilled)}
          sub={`${summary?.invoiceCount ?? 0} open invoices`}
        />
        <StatCard label="Total Collected" value={fmt(summary?.totalPaid)} />
        <StatCard label="Outstanding AR" value={fmt(summary?.totalOutstanding)} />
      </div>

      {recon && (
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">GL Reconciliation</h2>
          <p className="text-xs text-gray-400 mb-4">
            AR Subledger must equal the GL Accounts Receivable balance. A non-zero variance indicates a posting error.
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">AR Subledger</p>
              <p className="font-mono text-lg">{fmt(recon.arSubledgerBalance)}</p>
            </div>
            <div>
              <p className="text-gray-500">GL AR Account</p>
              <p className="font-mono text-lg">{fmt(recon.glArBalance)}</p>
            </div>
            <div>
              <p className="text-gray-500">Variance</p>
              <p className={`font-mono text-lg font-semibold ${recon.isReconciled ? 'text-green-600' : 'text-red-600'}`}>
                {fmt(recon.variance)}
                <span className="ml-1 text-sm">{recon.isReconciled ? '✓ Reconciled' : '⚠ Out of Balance'}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {!summary && tenantId && (
        <div className="card p-8 text-center text-gray-400">
          <p>No data yet. Create an invoice to get started.</p>
          <a href="/invoices/new" className="btn-primary inline-flex mt-4">+ Create Invoice</a>
        </div>
      )}
    </div>
  );
}
