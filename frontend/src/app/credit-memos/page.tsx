'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { creditMemosApi, customersApi, invoicesApi, glApi } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import { useTenant } from '../../components/TenantProvider';

export default function CreditMemosPage() {
  const { tenantId, userRole } = useTenant();
  const qc = useQueryClient();
  const isController = userRole === 'CONTROLLER';

  const [customerId, setCustomerId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [applyCmId, setApplyCmId] = useState<string | null>(null);
  const [applyInvoiceId, setApplyInvoiceId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [arAccountId, setArAccountId] = useState('');
  const [revenueAccountId, setRevenueAccountId] = useState('');

  const { data: memos, isLoading } = useQuery({
    queryKey: ['credit-memos', tenantId],
    queryFn: () => creditMemosApi.list().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => customersApi.list().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: invoices } = useQuery({
    queryKey: ['invoices-open', tenantId],
    queryFn: () => invoicesApi.list().then((r) => r.data.items),
    enabled: !!tenantId && !!applyCmId,
  });

  const openInvoices = invoices?.filter(
    (inv: { status: string; amountDue: string }) =>
      ['SENT', 'PARTIALLY_PAID', 'APPROVED'].includes(inv.status) && parseFloat(inv.amountDue) > 0,
  );

  const entityForGl = entityId || customers?.[0]?.entityId;

  const { data: arAccounts } = useQuery({
    queryKey: ['gl-ar', tenantId, entityForGl],
    queryFn: () =>
      glApi.accounts({ entityId: entityForGl!, type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' }).then((r) => r.data.data),
    enabled: !!tenantId && !!entityForGl && !!applyCmId,
  });

  const { data: revenueAccounts } = useQuery({
    queryKey: ['gl-rev', tenantId, entityForGl],
    queryFn: () => glApi.accounts({ entityId: entityForGl!, type: 'REVENUE' }).then((r) => r.data.data),
    enabled: !!tenantId && !!entityForGl && !!applyCmId,
  });

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => creditMemosApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-memos', tenantId] });
      setSuccess('Credit memo created.');
      setError('');
      setAmount('');
      setReason('');
    },
    onError: (e: Error) => { setError(e.message); setSuccess(''); },
  });

  const applyMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => creditMemosApi.apply(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-memos', tenantId] });
      qc.invalidateQueries({ queryKey: ['invoices', tenantId] });
      setApplyCmId(null);
      setSuccess('Credit memo applied to invoice.');
      setError('');
    },
    onError: (e: Error) => { setError(e.message); setSuccess(''); },
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isController) { setError('CONTROLLER role required'); return; }
    if (!customerId || !entityId || !amount || !reason) { setError('All fields required'); return; }
    createMutation.mutate({
      customerId,
      entityId,
      amount: parseFloat(amount),
      reason,
      originalInvoiceId: invoiceId || undefined,
    });
  };

  const startApply = (cmId: string, remaining: string) => {
    setApplyCmId(cmId);
    setApplyAmount(remaining);
    if (arAccounts?.[0]) setArAccountId(arAccounts[0].id);
    if (revenueAccounts?.[0]) setRevenueAccountId(revenueAccounts[0].id);
  };

  return (
    <div className="page-shell">
      <div className="mb-6">
        <h1 className="page-title">Credit Memos</h1>
        <p className="page-subtitle">Issue and apply credits against customer invoices</p>
      </div>

      {(error || success) && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${error ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900'}`}>
          {error || success}
        </div>
      )}

      {isController && (
        <form onSubmit={handleCreate} className="card mb-6 p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Create Credit Memo</p>
          </div>
          <div>
            <label className="label-field">Customer</label>
            <select
              className="input-field"
              value={customerId}
              onChange={(e) => {
                const c = customers?.find((x: { id: string }) => x.id === e.target.value);
                setCustomerId(e.target.value);
                if (c?.entityId) setEntityId(c.entityId);
              }}
            >
              <option value="">Select customer…</option>
              {customers?.map((c: { id: string; name: string; entityId: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Amount</label>
            <input type="number" step="0.01" className="input-field font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label-field">Reason</label>
            <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Billing error correction" />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create Credit Memo'}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="card-header">Credit Memos</div>
        <table className="data-table">
          <thead>
            <tr>
              {['Number', 'Amount', 'Remaining', 'Reason', 'Status', ''].map((h) => (
                <th key={h || 'actions'} className={h === 'Amount' || h === 'Remaining' || h === 'Status' ? 'text-right' : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && (!memos || memos.length === 0) && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No credit memos yet</td></tr>
            )}
            {memos?.map((cm: { id: string; creditMemoNumber: string; amount: string; remainingAmount: string; status: string; reason: string }) => (
              <tr key={cm.id}>
                <td className="cell-link font-mono">{cm.creditMemoNumber}</td>
                <td className="text-right cell-mono">{fmt(cm.amount)}</td>
                <td className="text-right cell-mono">{fmt(cm.remainingAmount)}</td>
                <td className="cell-muted max-w-xs truncate">{cm.reason}</td>
                <td className="text-right">
                  <span className="inline-flex justify-end"><StatusBadge status={cm.status} /></span>
                </td>
                <td className="px-5 py-3">
                  {isController && parseFloat(cm.remainingAmount) > 0 && cm.status !== 'APPLIED' && (
                    <button type="button" className="btn-secondary text-xs py-1" onClick={() => startApply(cm.id, cm.remainingAmount)}>
                      Apply
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {applyCmId && isController && (
        <form
          className="card mt-6 p-5 grid grid-cols-1 md:grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyMutation.mutate({
              id: applyCmId,
              payload: {
                invoiceId: applyInvoiceId,
                amount: parseFloat(applyAmount),
                arAccountId,
                revenueAccountId,
              },
            });
          }}
        >
          <div className="md:col-span-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Apply Credit Memo</p>
            <button type="button" className="text-xs text-slate-500" onClick={() => setApplyCmId(null)}>Cancel</button>
          </div>
          <div>
            <label className="label-field">Invoice</label>
            <select className="input-field" value={applyInvoiceId} onChange={(e) => setApplyInvoiceId(e.target.value)} required>
              <option value="">Select invoice…</option>
              {openInvoices?.map((inv: { id: string; invoiceNumber: string; amountDue: string }) => (
                <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — due {fmt(inv.amountDue)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Apply Amount</label>
            <input type="number" step="0.01" className="input-field font-mono" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} required />
          </div>
          <div>
            <label className="label-field">AR Account</label>
            <select className="input-field" value={arAccountId} onChange={(e) => setArAccountId(e.target.value)} required>
              {arAccounts?.map((a: { id: string; code: string; name: string }) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Revenue Account</label>
            <select className="input-field" value={revenueAccountId} onChange={(e) => setRevenueAccountId(e.target.value)} required>
              {revenueAccounts?.map((a: { id: string; code: string; name: string }) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="btn-primary" disabled={applyMutation.isPending}>
              {applyMutation.isPending ? 'Applying…' : 'Apply to Invoice'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
