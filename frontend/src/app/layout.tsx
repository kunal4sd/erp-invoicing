'use client';
import './globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TenantProvider, useTenant, ROLES } from '../components/TenantProvider';

const nav = [
  { href: '/', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/customers', label: 'Customers' },
  { href: '/reports', label: 'AR Aging' },
];

const ROLE_COLORS: Record<string, string> = {
  CONTROLLER: 'bg-blue-100 text-blue-700',
  AR_CLERK: 'bg-green-100 text-green-700',
  VIEWER: 'bg-gray-100 text-gray-500',
};

function Sidebar() {
  const pathname = usePathname();
  const { tenantName, tenants, switchTenant, tenantId, userRole, switchRole } = useTenant();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="text-xs font-semibold text-brand-600 uppercase tracking-widest">ERP Invoicing</p>
        <p className="text-xs text-gray-400 mt-0.5 truncate" title={tenantId}>
          {tenantName || 'Detecting tenant…'}
        </p>
      </div>

      {/* Tenant switcher — shown only when multiple tenants exist */}
      {tenants.length > 1 && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-400 mb-1">Tenant</p>
          <select
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 text-gray-600"
            value={tenantId}
            onChange={(e) => {
              const t = tenants.find((x) => x.id === e.target.value);
              if (t) switchTenant(t.id, t.name);
            }}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Role switcher — lets reviewer demo different permission levels */}
      <div className="px-4 pt-3">
        <p className="text-xs text-gray-400 mb-1">Demo Role</p>
        <select
          className={`w-full text-xs border border-gray-200 rounded px-2 py-1 font-medium ${ROLE_COLORS[userRole] ?? ''}`}
          value={userRole}
          onChange={(e) => switchRole(e.target.value as any)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {userRole !== 'CONTROLLER' && (
          <p className="text-xs text-orange-500 mt-1">
            Approve/Void require CONTROLLER
          </p>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === n.href ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">Multi-tenant AR Module</p>
        <p className="text-xs text-gray-300">© 2026 Deep Runner.AI</p>
      </div>
    </aside>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  return (
    <html lang="en">
      <head><title>ERP Invoicing — AR Module</title></head>
      <body>
        <QueryClientProvider client={qc}>
          <TenantProvider>
            <div className="min-h-screen flex">
              <Sidebar />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </TenantProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
