import axios from 'axios';
import { getStoredToken } from './auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// Attach stored JWT on load (browser only)
if (typeof window !== 'undefined') {
  const token = getStoredToken();
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.error?.message ?? err.message;
    console.error('API Error:', msg);
    return Promise.reject(new Error(msg));
  }
);

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function setTenantId(id: string) {
  api.defaults.headers['X-Tenant-ID'] = id;
}

/** @deprecated JWT carries role — kept for type compatibility */
export function setUserRole(_role: string) {
  // no-op: role comes from verified JWT
}

// ─── Typed API helpers ────────────────────────────────────────────────────────

export const invoicesApi = {
  list: (params?: Record<string, string>) => api.get('/invoices', { params }),
  get: (id: string) => api.get(`/invoices/${id}`),
  create: (data: unknown) => api.post('/invoices', data),
  approve: (id: string, data: unknown) => api.post(`/invoices/${id}/approve`, data),
  send: (id: string) => api.post(`/invoices/${id}/send`),
  void: (id: string) => api.post(`/invoices/${id}/void`),
  writeOff: (id: string, data: unknown) => api.post(`/invoices/${id}/write-off`, data),
};

export const paymentsApi = {
  create: (data: unknown) => api.post('/payments', data),
  get: (id: string) => api.get(`/payments/${id}`),
};

export const customersApi = {
  list: (params?: Record<string, string>) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: unknown) => api.post('/customers', data),
  aging: (id: string) => api.get(`/customers/${id}/aging`),
};

export const glApi = {
  entries: (params?: Record<string, string>) => api.get('/journal-entries', { params }),
  accounts: (params?: Record<string, string>) => api.get('/gl-accounts', { params }),
};

export const reportsApi = {
  arSummary: () => api.get('/reports/ar-summary'),
  arAging: () => api.get('/reports/ar-aging'),
  glReconciliation: () => api.get('/reports/gl-reconciliation'),
};

export const creditMemosApi = {
  list: (params?: Record<string, string>) => api.get('/credit-memos', { params }),
  create: (data: unknown) => api.post('/credit-memos', data),
  apply: (id: string, data: unknown) => api.post(`/credit-memos/${id}/apply`, data),
};

export const tenantsApi = {
  list: () => axios.get(`${API_BASE}/api/tenants`),
};

export const authApi = {
  demoLogin: (email: string, password: string) =>
    axios.post(`${API_BASE}/api/auth/demo-login`, { email, password }),
};
