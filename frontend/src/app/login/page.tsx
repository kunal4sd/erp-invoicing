'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';

const DEMO_CARDS = [
  {
    role: 'VIEWER' as const,
    title: 'Viewer',
    email: 'viewer@demo.local',
    desc: 'Read-only — browse invoices, customers, and reports',
    accent: 'from-slate-500 to-slate-600',
  },
  {
    role: 'AR_CLERK' as const,
    title: 'AR Clerk',
    email: 'clerk@demo.local',
    desc: 'Create invoices, send, and record payments',
    accent: 'from-emerald-500 to-emerald-600',
  },
  {
    role: 'CONTROLLER' as const,
    title: 'Controller',
    email: 'controller@demo.local',
    desc: 'Approve, void, and write off invoices',
    accent: 'from-blue-500 to-blue-600',
  },
];

export default function LoginPage() {
  const { login, loginAsDemo } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('controller@demo.local');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function quickLogin(role: 'VIEWER' | 'AR_CLERK' | 'CONTROLLER') {
    setError('');
    setLoading(true);
    try {
      await loginAsDemo(role);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 p-12 flex-col justify-between text-white">
        <div>
          <p className="text-xs font-bold text-brand-400 uppercase tracking-widest">Deep Runner.AI Assessment</p>
          <h1 className="text-4xl font-bold mt-4 leading-tight">ERP Invoicing<br />& Accounts Receivable</h1>
          <p className="text-slate-300 mt-4 max-w-md">
            Multi-tenant AR module with GL integration, invoice lifecycle, payment allocation, and role-based access control.
          </p>
        </div>
        <div className="space-y-3 text-sm text-slate-400">
          <p>✓ Double-entry journal entries on approve &amp; payment</p>
          <p>✓ AR aging &amp; GL reconciliation reports</p>
          <p>✓ JWT auth with CONTROLLER / AR_CLERK / VIEWER roles</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden text-center">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-widest">ERP Invoicing</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-2">Demo Login</h1>
          </div>

          <p className="text-sm text-slate-500 mb-4 text-center lg:text-left">
            Quick-login as a demo user — password: <code className="bg-white px-1.5 py-0.5 rounded border text-slate-700">demo</code>
          </p>

          <div className="space-y-3 mb-6">
            {DEMO_CARDS.map((card) => (
              <button
                key={card.role}
                type="button"
                disabled={loading}
                onClick={() => quickLogin(card.role)}
                className="w-full text-left card p-4 hover:shadow-md transition-shadow disabled:opacity-50 group"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.accent} flex items-center justify-center text-white text-xs font-bold`}>
                    {card.title[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 group-hover:text-brand-700">{card.title}</p>
                    <p className="text-xs text-slate-400 font-mono">{card.email}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2 pl-[52px]">{card.desc}</p>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <p className="text-sm font-semibold text-slate-800">Manual sign-in</p>
            <div>
              <label className="label-field">Email</label>
              <input type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label-field">Password</label>
              <input type="password" className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={loading} className="w-full btn-primary py-2.5">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
