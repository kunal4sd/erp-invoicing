'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { invoicesApi, glApi } from '../../../lib/api';
import { useTenant } from '../../../components/TenantProvider';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge-${status.toLowerCase()}`}>{status.replace('_', ' ')}</span>;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { tenantId, userRole } = useTenant();
  const [arAccountId, setArAccountId] = useState('');
  const [approveError, setApproveError] = useState('');

  const { data: inv, isLoading } = useQuery({
    queryKey: ['invoice', tenantId, id],
    queryFn: () => invoicesApi.get(id).then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: glData } = useQuery({
    queryKey: ['je', tenantId, id],
    queryFn: () => glApi.entries({ invoice: id }).then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: arAccounts } = useQuery({
    queryKey: ['gl-accounts-ar', tenantId, inv?.entityId],
    queryFn: () =>
      glApi
        .accounts({
          entityId: inv!.entityId,
          type: 'ASSET',
          subtype: 'ACCOUNTS_RECEIVABLE',
        })
        .then((r) => r.data.data),
    enabled: !!tenantId && !!inv?.entityId && inv?.status === 'DRAFT',
  });

  useEffect(() => {
    if (arAccounts?.length && !arAccountId) {
      setArAccountId(arAccounts[0].id);
    }
  }, [arAccounts, arAccountId]);

  const approveMutation = useMutation({
    mutationFn: () => invoicesApi.approve(id, { arAccountId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', tenantId, id] });
      qc.invalidateQueries({ queryKey: ['invoices', tenantId] });
      setApproveError('');
    },
    onError: (e: Error) => setApproveError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => invoicesApi.void(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', tenantId, id] });
      qc.invalidateQueries({ queryKey: ['invoices', tenantId] });
    },
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  if (!tenantId || isLoading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (!inv) return <div className="p-8 text-red-500">Invoice not found</div>;

  return (
    <div className="p-8 max-w-4xl">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-800 mb-4">← Back</button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{inv.invoiceNumber}</h1>
          <p className="text-gray-500">{inv.customer?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={inv.status} />
          {inv.status === 'DRAFT' && (
            <div className="flex items-center gap-2">
              {arAccounts && arAccounts.length > 0 ? (
                <select
                  className="border rounded px-2 py-1 text-xs w-52"
                  value={arAccountId}
                  onChange={(e) => setArAccountId(e.target.value)}
                >
                  <option value="">Select AR Account…</option>
                  {arAccounts.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="border rounded px-2 py-1 text-xs w-48"
                  placeholder="AR Account ID"
                  value={arAccountId}
                  onChange={(e) => setArAccountId(e.target.value)}
                />
              )}
              <button
                className={`btn-primary text-xs py-1 ${userRole !== 'CONTROLLER' ? 'opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => approveMutation.mutate()}
                disabled={!arAccountId || approveMutation.isPending || userRole !== 'CONTROLLER'}
                title={userRole !== 'CONTROLLER' ? 'CONTROLLER role required to approve invoices' : undefined}
              >
                {approveMutation.isPending ? 'Approving…' : 'Approve'}
              </button>
              {userRole !== 'CONTROLLER' && (
                <span className="text-xs text-orange-500">CONTROLLER only</span>
              )}
            </div>
          )}
          {['DRAFT', 'APPROVED', 'SENT'].includes(inv.status) && (
            <button
              className={`btn-secondary text-xs py-1 text-red-600 border-red-200 hover:bg-red-50 ${userRole !== 'CONTROLLER' ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={() => voidMutation.mutate()}
              disabled={voidMutation.isPending || userRole !== 'CONTROLLER'}
              title={userRole !== 'CONTROLLER' ? 'CONTROLLER role required to void invoices' : undefined}
            >
              {voidMutation.isPending ? 'Voiding…' : 'Void'}
            </button>
          )}
        </div>
      </div>
      {approveError && <p className="text-red-500 text-sm mb-4">{approveError}</p>}

      <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
        <div className="card p-4">
          <p className="text-gray-500 text-xs">Issue Date</p>
          <p className="font-medium">{format(new Date(inv.issueDate), 'MMM d, yyyy')}</p>
        </div>
        <div className="card p-4">
          <p className="text-gray-500 text-xs">Due Date</p>
          <p className="font-medium">{format(new Date(inv.dueDate), 'MMM d, yyyy')}</p>
        </div>
        <div className="card p-4">
          <p className="text-gray-500 text-xs">Currency</p>
          <p className="font-medium">{inv.currency}</p>
        </div>
      </div>

      {/* Line Items */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 font-medium text-sm">Line Items</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Description', 'Qty', 'Unit Price', 'Tax', 'Amount'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {inv.lineItems?.map((line: any) => (
              <tr key={line.id}>
                <td className="px-4 py-2">{line.description}</td>
                <td className="px-4 py-2 font-mono">{line.quantity}</td>
                <td className="px-4 py-2 font-mono">{fmt(line.unitPrice)}</td>
                <td className="px-4 py-2 font-mono">{(parseFloat(line.taxRate) * 100).toFixed(0)}%</td>
                <td className="px-4 py-2 font-mono font-medium">{fmt(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-xs text-gray-500">Subtotal</td>
              <td className="px-4 py-2 font-mono">{fmt(inv.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-xs text-gray-500">Tax</td>
              <td className="px-4 py-2 font-mono">{fmt(inv.taxAmount)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right font-semibold text-sm">Total</td>
              <td className="px-4 py-2 font-mono font-bold text-base">{fmt(inv.total)}</td>
            </tr>
            <tr className="text-green-700">
              <td colSpan={4} className="px-4 py-2 text-right text-xs">Paid</td>
              <td className="px-4 py-2 font-mono">({fmt(inv.amountPaid)})</td>
            </tr>
            <tr className="text-brand-700">
              <td colSpan={4} className="px-4 py-2 text-right font-semibold">Balance Due</td>
              <td className="px-4 py-2 font-mono font-bold">{fmt(inv.amountDue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment History */}
      {inv.paymentAllocations && inv.paymentAllocations.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100 font-medium text-sm">
            Payment History ({inv.paymentAllocations.length})
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Method', 'Reference', 'Amount Applied'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inv.paymentAllocations.map((alloc: any) => (
                <tr key={alloc.id}>
                  <td className="px-4 py-2 text-gray-500">
                    {alloc.payment?.paymentDate
                      ? format(new Date(alloc.payment.paymentDate), 'MMM d, yyyy')
                      : '–'}
                  </td>
                  <td className="px-4 py-2">{alloc.payment?.method ?? '–'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{alloc.payment?.referenceNumber ?? '–'}</td>
                  <td className="px-4 py-2 font-mono text-green-700">{fmt(alloc.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GL Entries */}
      {glData && glData.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100 font-medium text-sm">
            Journal Entries ({glData.length})
          </div>
          {glData.map((je: any) => (
            <div key={je.id} className="p-4 border-b border-gray-50 last:border-0">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-xs text-gray-500">{je.entryNumber}</p>
                <p className="text-xs text-gray-400">{format(new Date(je.postingDate), 'MMM d, yyyy')}</p>
              </div>
              <p className="text-sm text-gray-700 mb-2">{je.description}</p>
              <table className="w-full text-xs">
                <thead><tr>
                  <th className="text-left text-gray-400 pb-1">Account</th>
                  <th className="text-right text-gray-400 pb-1">Debit</th>
                  <th className="text-right text-gray-400 pb-1">Credit</th>
                </tr></thead>
                <tbody>
                  {je.lines?.map((line: any) => (
                    <tr key={line.id}>
                      <td className="py-0.5">{line.glAccount?.code} — {line.glAccount?.name}</td>
                      <td className="text-right font-mono">{parseFloat(line.debit) > 0 ? fmt(line.debit) : ''}</td>
                      <td className="text-right font-mono text-gray-500">{parseFloat(line.credit) > 0 ? fmt(line.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
