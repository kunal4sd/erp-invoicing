'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { customersApi, glApi, invoicesApi } from '../../../lib/api';
import { useTenant } from '../../../components/TenantProvider';

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  glAccountId: string;
}

const emptyLine = (): LineItem => ({ description: '', quantity: '1', unitPrice: '0', taxRate: '0', glAccountId: '' });

export default function NewInvoicePage() {
  const router = useRouter();
  const { tenantId, userRole } = useTenant();
  const [customerId, setCustomerId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [error, setError] = useState('');

  const { data: customers } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => customersApi.list().then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const { data: glAccounts } = useQuery({
    queryKey: ['gl-accounts-revenue', tenantId],
    queryFn: () => glApi.accounts({ type: 'REVENUE' }).then((r) => r.data.data),
    enabled: !!tenantId,
  });

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => invoicesApi.create(payload),
    onSuccess: (res) => router.push(`/invoices/${res.data.data.id}`),
    onError: (e: Error) => setError(e.message),
  });

  const updateLine = (i: number, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  };

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0);
  const tax = lines.reduce((s, l) => {
    const amt = (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
    return s + amt * (parseFloat(l.taxRate) || 0);
  }, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (userRole === 'VIEWER') { setError('Permission denied — VIEWER role cannot create invoices. Switch to AR_CLERK or CONTROLLER.'); return; }
    if (!customerId || !entityId || !dueDate) { setError('Customer, Entity, and Due Date are required'); return; }

    createMutation.mutate({
      entityId,
      customerId,
      dueDate,
      currency,
      notes,
      lineItems: lines.map((l) => ({
        description: l.description,
        quantity: parseFloat(l.quantity),
        unitPrice: parseFloat(l.unitPrice),
        taxRate: parseFloat(l.taxRate),
        glAccountId: l.glAccountId || undefined,
      })),
    });
  };

  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2 });

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-800 mb-2">← Back</button>
        <h1 className="text-2xl font-bold">New Invoice</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header fields */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-gray-700">Invoice Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer *</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  const c = customers?.find((x: any) => x.id === e.target.value);
                  if (c) setEntityId(c.entityId);
                }}>
                <option value="">Select customer…</option>
                {customers?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Due Date *</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={currency}
                onChange={(e) => setCurrency(e.target.value)}>
                {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 text-sm">Line Items</h2>
            <button type="button" className="text-xs text-brand-600 hover:underline"
              onClick={() => setLines((l) => [...l, emptyLine()])}>+ Add Line</button>
          </div>
          <div className="p-4 space-y-3">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <input className="col-span-4 border rounded px-2 py-1 text-sm" placeholder="Description"
                  value={line.description} onChange={(e) => updateLine(i, 'description', e.target.value)} />
                <input className="col-span-1 border rounded px-2 py-1 text-sm" placeholder="Qty" type="number"
                  value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} />
                <input className="col-span-2 border rounded px-2 py-1 text-sm" placeholder="Unit Price" type="number"
                  value={line.unitPrice} onChange={(e) => updateLine(i, 'unitPrice', e.target.value)} />
                <input className="col-span-1 border rounded px-2 py-1 text-sm" placeholder="Tax" type="number" step="0.01"
                  value={line.taxRate} onChange={(e) => updateLine(i, 'taxRate', e.target.value)} />
                <select className="col-span-3 border rounded px-2 py-1 text-sm" value={line.glAccountId}
                  onChange={(e) => updateLine(i, 'glAccountId', e.target.value)}>
                  <option value="">GL Account</option>
                  {glAccounts?.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <button type="button" className="col-span-1 text-red-400 hover:text-red-600 text-sm mt-1"
                  onClick={() => setLines((l) => l.filter((_, idx) => idx !== i))}
                  disabled={lines.length === 1}>✕</button>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-right text-sm space-y-1">
            <p className="text-gray-500">Subtotal: <span className="font-mono">${fmt(subtotal)}</span></p>
            <p className="text-gray-500">Tax: <span className="font-mono">${fmt(tax)}</span></p>
            <p className="font-bold">Total: <span className="font-mono">${fmt(subtotal + tax)}</span></p>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            className={`btn-primary ${userRole === 'VIEWER' ? 'opacity-40 cursor-not-allowed' : ''}`}
            disabled={createMutation.isPending}
            title={userRole === 'VIEWER' ? 'VIEWER role cannot create invoices' : undefined}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Invoice'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
