'use client';

/**
 * Compatibility shim — pages use useTenant(); auth now comes from JWT via AuthProvider.
 */
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';

export function useTenant() {
  const { user } = useAuth();
  return {
    tenantId: user?.tenantId ?? '',
    tenantName: user?.tenantName ?? '',
    tenants: [] as Array<{ id: string; name: string }>,
    userRole: (user?.role ?? 'VIEWER') as 'CONTROLLER' | 'AR_CLERK' | 'VIEWER',
    switchTenant: () => {},
    switchRole: () => {},
  };
}

export const ROLES = ['CONTROLLER', 'AR_CLERK', 'VIEWER'] as const;
export type Role = typeof ROLES[number];

/** @deprecated use AuthProvider */
export function TenantProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
