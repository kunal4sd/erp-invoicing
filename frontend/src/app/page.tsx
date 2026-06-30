'use client';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../lib/api';
import { useTenant } from '../components/TenantProvider';

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${accent ?? ''}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
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
    <div className="page-shell">
      <div className="mb-8">
        <h1 className="page-title">Accounts Receivable Dashboard</h1>
        <p className="page-subtitle">Real-time AR overview with GL reconciliation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <StatCard
          label="Total Billed (Open)"
          value={fmt(summary?.totalBilled)}
          sub={`${summary?.invoiceCount ?? 0} open invoices`}
        />
        <StatCard label="Total Collected" value={fmt(summary?.totalPaid)} accent="text-emerald-600" />
        <StatCard label="Outstanding AR" value={fmt(summary?.totalOutstanding)} accent="text-brand-700" />
      </div>

      {recon && (
        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">GL Reconciliation</h2>
          <p className="text-xs text-slate-400 mb-5">
            AR subledger must equal the GL Accounts Receivable balance.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div className="stat-card !p-4">
              <p className="stat-label">AR Subledger</p>
              <p className="font-mono text-xl font-semibold mt-1">{fmt(recon.arSubledgerBalance)}</p>
            </div>
            <div className="stat-card !p-4">
              <p className="stat-label">GL AR Account</p>
              <p className="font-mono text-xl font-semibold mt-1">{fmt(recon.glArBalance)}</p>
            </div>
            <div className={`stat-card !p-4 ${recon.isReconciled ? 'ring-2 ring-emerald-200' : 'ring-2 ring-red-200'}`}>
              <p className="stat-label">Variance</p>
              <p className={`font-mono text-xl font-bold mt-1 ${recon.isReconciled ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmt(recon.variance)}
              </p>
              <p className="text-xs mt-1 font-medium">{recon.isReconciled ? '✓ Reconciled' : '⚠ Out of Balance'}</p>
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
