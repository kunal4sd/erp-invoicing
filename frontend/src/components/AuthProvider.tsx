'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import axios from 'axios';
import { api, setAuthToken, setTenantId } from '../lib/api';
import { AuthUser, clearAuth, getStoredToken, getStoredUser, saveAuth } from '../lib/auth';

interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginAsDemo: (role: 'VIEWER' | 'AR_CLERK' | 'CONTROLLER') => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  isLoading: true,
  login: async () => {},
  loginAsDemo: async () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const DEMO_ACCOUNTS: Record<'VIEWER' | 'AR_CLERK' | 'CONTROLLER', string> = {
  VIEWER: 'viewer@demo.local',
  AR_CLERK: 'clerk@demo.local',
  CONTROLLER: 'controller@demo.local',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback((token: string, authUser: AuthUser) => {
    saveAuth(token, authUser);
    setAuthToken(token);
    setTenantId(authUser.tenantId);
    setUser(authUser);
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    const stored = getStoredUser();
    if (token && stored) {
      setAuthToken(token);
      setTenantId(stored.tenantId);
      setUser(stored);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await axios.post(`${apiBase}/api/auth/demo-login`, { email, password });
    const { token, user: authUser } = res.data.data;
    applySession(token, authUser);
  }, [applySession]);

  const loginAsDemo = useCallback(async (role: 'VIEWER' | 'AR_CLERK' | 'CONTROLLER') => {
    await login(DEMO_ACCOUNTS[role], 'demo');
  }, [login]);

  const logout = useCallback(() => {
    clearAuth();
    setAuthToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginAsDemo, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export { DEMO_ACCOUNTS };
