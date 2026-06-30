'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { invoicesApi, glApi, paymentsApi } from '../../../lib/api';
import { useTenant } from '../../../components/TenantProvider';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { StatusBadge } from '../../../components/StatusBadge';

const PAYABLE = new Set(['APPROVED', 'SENT', 'PARTIALLY_PAID']);

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { tenantId, userRole } = useTenant();

  const [arAccountId, setArAccountId] = useState('');
  const [badDebtAccountId, setBadDebtAccountId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [payArAccountId, setPayArAccountId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('ACH');
  const [payReference, setPayReference] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const isController = userRole === 'CONTROLLER';
  const canWrite = userRole === 'AR_CLERK' || isController;

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

  const entityId = inv?.entityId as string | undefined;

  const { data: arAccounts } = useQuery({
    queryKey: ['gl-ar', tenantId, entityId],
    queryFn: () =>
      glApi.accounts({ entityId: entityId!, type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' }).then((r) => r.data.data),
    enabled: !!tenantId && !!entityId,
  });

  const { data: cashAccounts } = useQuery({
    queryKey: ['gl-cash', tenantId, entityId],
    queryFn: () =>
      glApi.accounts({ entityId: entityId!, type: 'ASSET', subtype: 'CASH' }).then((r) => r.data.data),
    enabled: !!tenantId && !!entityId && !!inv && PAYABLE.has(inv.status),
  });

  const { data: expenseAccounts } = useQuery({
    queryKey: ['gl-expense', tenantId, entityId],
    queryFn: () => glApi.accounts({ entityId: entityId!, type: 'EXPENSE' }).then((r) => r.data.data),
    enabled: !!tenantId && !!entityId && !!inv && ['SENT', 'PARTIALLY_PAID'].includes(inv.status),
  });

  useEffect(() => {
    if (arAccounts?.length && !arAccountId) setArAccountId(arAccounts[0].id);
    if (arAccounts?.length && !payArAccountId) setPayArAccountId(arAccounts[0].id);
    if (cashAccounts?.length && !cashAccountId) setCashAccountId(cashAccounts[0].id);
    if (expenseAccounts?.length && !badDebtAccountId) setBadDebtAccountId(expenseAccounts[0].id);
  }, [arAccounts, cashAccounts, expenseAccounts, arAccountId, payArAccountId, cashAccountId, badDebtAccountId]);

  useEffect(() => {
    if (inv?.amountDue && !payAmount) setPayAmount(String(parseFloat(inv.amountDue)));
  }, [inv?.amountDue, payAmount]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoice', tenantId, id] });
    qc.invalidateQueries({ queryKey: ['invoices', tenantId] });
    qc.invalidateQueries({ queryKey: ['je', tenantId, id] });
    qc.invalidateQueries({ queryKey: ['ar-summary', tenantId] });
    qc.invalidateQueries({ queryKey: ['gl-reconciliation', tenantId] });
  };

  const approveMutation = useMutation({
    mutationFn: () => invoicesApi.approve(id, { arAccountId }),
    onSuccess: () => { invalidate(); setActionError(''); setActionSuccess('Invoice approved — GL entry posted.'); },
    onError: (e: Error) => { setActionSuccess(''); setActionError(e.message); },
  });

  const sendMutation = useMutation({
    mutationFn: () => invoicesApi.send(id),
    onSuccess: () => { invalidate(); setActionError(''); setActionSuccess('Invoice marked as sent.'); },
    onError: (e: Error) => { setActionSuccess(''); setActionError(e.message); },
  });

  const voidMutation = useMutation({
    mutationFn: () => invoicesApi.void(id),
    onSuccess: () => { invalidate(); setActionError(''); setActionSuccess('Invoice voided.'); },
    onError: (e: Error) => { setActionSuccess(''); setActionError(e.message); },
  });

  const writeOffMutation = useMutation({
    mutationFn: () => invoicesApi.writeOff(id, { badDebtAccountId }),
    onSuccess: () => { invalidate(); setActionError(''); setActionSuccess('Invoice written off as bad debt.'); },
    onError: (e: Error) => { setActionSuccess(''); setActionError(e.message); },
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      paymentsApi.create({
        entityId: inv!.entityId,
        customerId: inv!.customerId,
        amount: parseFloat(payAmount),
        method: payMethod,
        referenceNumber: payReference || undefined,
        cashAccountId,
        arAccountId: payArAccountId,
        idempotencyKey: crypto.randomUUID(),
        allocations: [{ invoiceId: id, amount: parseFloat(payAmount) }],
      }),
    onSuccess: () => {
      invalidate();
      setActionError('');
      setActionSuccess('Payment recorded and applied to this invoice.');
      setPayReference('');
    },
    onError: (e: Error) => { setActionSuccess(''); setActionError(e.message); },
  });

  const fmt = (v: string | number) =>
    `$${parseFloat(String(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  if (!tenantId || isLoading) {
    return <div className="page-shell text-slate-400">Loading invoice…</div>;
  }
  if (!inv) return <div className="page-shell text-red-500">Invoice not found</div>;

  const balanceDue = parseFloat(String(inv.amountDue));
  const canPay = PAYABLE.has(inv.status) && balanceDue > 0;
  const canWriteOff = ['SENT', 'PARTIALLY_PAID'].includes(inv.status) && balanceDue > 0;

  return (
    <div className="page-shell">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-800 mb-4">
        ← Back to invoices
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title">{inv.invoiceNumber}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="page-subtitle">{inv.customer?.name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Balance Due</p>
          <p className="text-3xl font-bold text-brand-700 font-mono">{fmt(inv.amountDue)}</p>
        </div>
      </div>

      {(actionError || actionSuccess) && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${actionError ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-800 border border-emerald-100'}`}>
          {actionError || actionSuccess}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Issue Date', value: format(new Date(inv.issueDate), 'MMM d, yyyy') },
          { label: 'Due Date', value: format(new Date(inv.dueDate), 'MMM d, yyyy') },
          { label: 'Total', value: fmt(inv.total) },
          { label: 'Amount Paid', value: fmt(inv.amountPaid) },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p className="stat-label">{s.label}</p>
            <p className="text-sm font-semibold text-slate-800 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      {inv.status !== 'PAID' && inv.status !== 'VOID' && inv.status !== 'WRITTEN_OFF' && (
        <div className="card mb-6">
          <div className="card-header">Invoice Actions</div>
          <div className="p-5 flex flex-wrap gap-3 items-end">
            {inv.status === 'DRAFT' && (
              <>
                <div className="flex-1 min-w-[200px]">
                  <label className="label-field">AR Account</label>
                  <select className="input-field" value={arAccountId} onChange={(e) => setArAccountId(e.target.value)}>
                    <option value="">Select AR account…</option>
                    {arAccounts?.map((a: { id: string; code: string; name: string }) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => approveMutation.mutate()}
                  disabled={!arAccountId || approveMutation.isPending || !isController}
                  title={!isController ? 'CONTROLLER role required' : undefined}
                >
                  {approveMutation.isPending ? 'Approving…' : 'Approve & Post to GL'}
                </button>
              </>
            )}

            {inv.status === 'APPROVED' && canWrite && (
              <button className="btn-secondary" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                {sendMutation.isPending ? 'Sending…' : 'Mark as Sent'}
              </button>
            )}

            {['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(inv.status) && (
              <button
                className="btn-danger"
                onClick={() => voidMutation.mutate()}
                disabled={voidMutation.isPending || !isController}
                title={!isController ? 'CONTROLLER role required' : undefined}
              >
                {voidMutation.isPending ? 'Voiding…' : 'Void Invoice'}
              </button>
            )}

            {canWriteOff && (
              <>
                <div className="flex-1 min-w-[200px]">
                  <label className="label-field">Bad Debt Account</label>
                  <select className="input-field" value={badDebtAccountId} onChange={(e) => setBadDebtAccountId(e.target.value)}>
                    {expenseAccounts?.map((a: { id: string; code: string; name: string }) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn-danger"
                  onClick={() => writeOffMutation.mutate()}
                  disabled={!badDebtAccountId || writeOffMutation.isPending || !isController}
                  title={!isController ? 'CONTROLLER role required' : undefined}
                >
                  {writeOffMutation.isPending ? 'Writing off…' : 'Write Off'}
                </button>
              </>
            )}

            {!isController && inv.status === 'DRAFT' && (
              <p className="text-xs text-amber-600 w-full">Approve / Void require CONTROLLER role. Sign out and log in as controller@demo.local</p>
            )}
          </div>
        </div>
      )}

      {/* Record Payment */}
      {canPay && (
        <div className="card mb-6">
          <div className="card-header flex items-center justify-between">
            <span>Record Payment</span>
            {!canWrite && <span className="text-xs font-normal text-slate-400">AR_CLERK or CONTROLLER required</span>}
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label-field">Amount</label>
              <input type="number" step="0.01" className="input-field font-mono" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <label className="label-field">Method</label>
              <select className="input-field" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={!canWrite}>
                {['ACH', 'WIRE', 'CHECK', 'CASH', 'BANK_TRANSFER', 'CREDIT_CARD'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Reference #</label>
              <input className="input-field" placeholder="e.g. ACH-2026-0701" value={payReference} onChange={(e) => setPayReference(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <label className="label-field">Cash Account</label>
              <select className="input-field" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} disabled={!canWrite}>
                {cashAccounts?.map((a: { id: string; code: string; name: string }) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">AR Account</label>
              <select className="input-field" value={payArAccountId} onChange={(e) => setPayArAccountId(e.target.value)} disabled={!canWrite}>
                {arAccounts?.map((a: { id: string; code: string; name: string }) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                className="btn-success w-full"
                onClick={() => paymentMutation.mutate()}
                disabled={!canWrite || !payAmount || !cashAccountId || !payArAccountId || paymentMutation.isPending}
              >
                {paymentMutation.isPending ? 'Recording…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Line Items */}
      <div className="card overflow-hidden mb-6">
        <div className="card-header">Line Items</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Description', 'Qty', 'Unit Price', 'Tax', 'Amount'].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.lineItems?.map((line: { id: string; description: string; quantity: string; unitPrice: string; taxRate: string; amount: string }) => (
              <tr key={line.id}>
                <td className="px-5 py-3">{line.description}</td>
                <td className="px-5 py-3 font-mono">{line.quantity}</td>
                <td className="px-5 py-3 font-mono">{fmt(line.unitPrice)}</td>
                <td className="px-5 py-3 font-mono">{(parseFloat(line.taxRate) * 100).toFixed(0)}%</td>
                <td className="px-5 py-3 font-mono font-medium">{fmt(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50">
            <tr>
              <td colSpan={4} className="px-5 py-2 text-right text-xs text-slate-500">Subtotal</td>
              <td className="px-5 py-2 font-mono">{fmt(inv.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-5 py-2 text-right text-xs text-slate-500">Tax</td>
              <td className="px-5 py-2 font-mono">{fmt(inv.taxAmount)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-5 py-3 text-right font-semibold">Total</td>
              <td className="px-5 py-3 font-mono font-bold text-base">{fmt(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment History */}
      {inv.paymentAllocations && inv.paymentAllocations.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="card-header">Payment History ({inv.paymentAllocations.length})</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['Date', 'Method', 'Reference', 'Amount Applied'].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inv.paymentAllocations.map((alloc: { id: string; amount: string; payment?: { paymentDate?: string; method?: string; referenceNumber?: string } }) => (
                <tr key={alloc.id}>
                  <td className="px-5 py-3 text-slate-500">
                    {alloc.payment?.paymentDate ? format(new Date(alloc.payment.paymentDate), 'MMM d, yyyy') : '–'}
                  </td>
                  <td className="px-5 py-3">{alloc.payment?.method ?? '–'}</td>
                  <td className="px-5 py-3 font-mono text-xs">{alloc.payment?.referenceNumber ?? '–'}</td>
                  <td className="px-5 py-3 font-mono text-emerald-700 font-medium">{fmt(alloc.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GL Entries */}
      {glData && glData.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="card-header">Journal Entries ({glData.length})</div>
          {glData.map((je: { id: string; entryNumber: string; postingDate: string; description: string; lines?: Array<{ id: string; debit: string; credit: string; glAccount?: { code: string; name: string } }> }) => (
            <div key={je.id} className="p-5 border-b border-slate-50 last:border-0">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-xs font-semibold text-brand-600">{je.entryNumber}</p>
                <p className="text-xs text-slate-400">{format(new Date(je.postingDate), 'MMM d, yyyy')}</p>
              </div>
              <p className="text-sm text-slate-700 mb-3">{je.description}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-slate-400 pb-1">Account</th>
                    <th className="text-right text-slate-400 pb-1">Debit</th>
                    <th className="text-right text-slate-400 pb-1">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {je.lines?.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1">{line.glAccount?.code} — {line.glAccount?.name}</td>
                      <td className="text-right font-mono">{parseFloat(line.debit) > 0 ? fmt(line.debit) : ''}</td>
                      <td className="text-right font-mono text-slate-500">{parseFloat(line.credit) > 0 ? fmt(line.credit) : ''}</td>
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
