'use client';

import './globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '../components/AuthProvider';
import { ThemeProvider, useTheme } from '../components/ThemeProvider';

const nav = [
  { href: '/', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/customers', label: 'Customers' },
  { href: '/credit-memos', label: 'Credit Memos' },
  { href: '/reports', label: 'AR Aging' },
];

const ROLE_COLORS: Record<string, string> = {
  CONTROLLER: 'bg-blue-500/20 text-blue-300',
  AR_CLERK: 'bg-emerald-500/20 text-emerald-300',
  VIEWER: 'bg-slate-600 text-slate-300',
};

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <aside className="w-60 bg-slate-900 text-slate-100 flex flex-col shrink-0">
      <div className="px-5 py-6 border-b border-slate-800">
        <p className="text-xs font-bold text-brand-400 uppercase tracking-widest">ERP Invoicing</p>
        <p className="text-xs text-slate-400 mt-1 truncate" title={user?.tenantName}>
          {user?.tenantName ?? '—'}
        </p>
      </div>

      <div className="px-4 py-4 border-b border-slate-800">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Signed in</p>
        <p className="text-sm font-medium truncate">{user?.name}</p>
        <p className="text-xs text-slate-500 font-mono truncate">{user?.email}</p>
        <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide ${ROLE_COLORS[user?.role ?? ''] ?? 'bg-slate-700 text-slate-300'}`}>
          {user?.role}
        </span>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              pathname === n.href
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Session</p>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-slate-300 hover:text-white transition-colors text-left"
          >
            Sign out
          </button>
          <ThemeToggleButton />
        </div>
      </div>
    </aside>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname !== '/login') {
      router.replace('/login');
    }
    if (user && pathname === '/login') {
      router.replace('/');
    }
  }, [user, isLoading, pathname, router]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm dark:bg-slate-950">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">{children}</main>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  return (
    <html lang="en" suppressHydrationWarning>
      <head><title>ERP Invoicing — AR Module</title></head>
      <body>
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
