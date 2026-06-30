'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import { setTenantId, setUserRole } from '../lib/api';

const ROLES = ['CONTROLLER', 'AR_CLERK', 'VIEWER'] as const;
type Role = typeof ROLES[number];

interface TenantCtx {
  tenantId: string;
  tenantName: string;
  tenants: Array<{ id: string; name: string }>;
  userRole: Role;
  switchTenant: (id: string, name: string) => void;
  switchRole: (role: Role) => void;
}

const TenantContext = createContext<TenantCtx>({
  tenantId: '',
  tenantName: '',
  tenants: [],
  userRole: 'CONTROLLER',
  switchTenant: () => {},
  switchRole: () => {},
});

export function useTenant() {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState(process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? '');
  const [tenantName, setTenantName] = useState('');
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  // Default to CONTROLLER so approve/void/write-off work immediately in the demo
  const [userRole, setUserRoleState] = useState<Role>('CONTROLLER');

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    axios.get(`${apiBase}/api/tenants`).then((r) => {
      const list = r.data.data ?? [];
      setTenants(list);
      if (!tenantId && list.length > 0) {
        const first = list[0];
        setTenantIdState(first.id);
        setTenantName(first.name);
        setTenantId(first.id);
      } else if (tenantId) {
        const found = list.find((t: any) => t.id === tenantId);
        setTenantName(found?.name ?? tenantId);
        setTenantId(tenantId);
      }
    }).catch(() => {
      // API may not be up yet — silent fail
    });
  }, []);

  const switchTenant = (id: string, name: string) => {
    setTenantIdState(id);
    setTenantName(name);
    setTenantId(id);
  };

  const switchRole = (role: Role) => {
    setUserRoleState(role);
    setUserRole(role);
  };

  return (
    <TenantContext.Provider value={{ tenantId, tenantName, tenants, userRole, switchTenant, switchRole }}>
      {children}
    </TenantContext.Provider>
  );
}

export { ROLES };
export type { Role };
