/**
 * API client. The access token lives in memory only (never localStorage);
 * the refresh token is an httpOnly cookie the browser sends to /api/auth.
 * A 401 triggers one shared refresh attempt, then the request is retried.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
export const setAccessToken = (t: string | null) => (accessToken = t);
export const setSessionLostHandler = (fn: () => void) => (onSessionLost = fn);

let refreshing: Promise<RefreshResult | null> | null = null;
export interface RefreshResult {
  accessToken: string;
  user: User;
  memberships: Membership[];
}

export function refreshSession(): Promise<RefreshResult | null> {
  refreshing ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'closewell' } });
      if (res.status === 409) continue; // another tab rotated at the same moment; the cookie is fresh now
      if (!res.ok) return null;
      const { data } = await res.json();
      accessToken = data.accessToken;
      return data as RefreshResult;
    }
    return null;
  })().finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: { message?: string; code?: string; details?: { fields?: Record<string, string> } } } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const e = body.error;
  const fallback = res.status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${res.status})`;
  return new ApiError(e?.message ?? fallback, res.status, e?.code ?? 'error', e?.details?.fields ?? {}, e?.details);
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'network');
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const r = await refreshSession();
    if (r) return request<T>(path, init, true);
    onSessionLost?.();
  }
  if (!res.ok) throw await toError(res);
  if (init.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<{ data: T }>(p).then((r) => r.data),
  list: <T>(p: string) => request<{ data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(p),
  post: <T>(p: string, json?: unknown) => request<{ data: T }>(p, { method: 'POST', json: json ?? {} }).then((r) => r.data),
  put: <T>(p: string, json: unknown) => request<{ data: T }>(p, { method: 'PUT', json }).then((r) => r.data),
  patch: <T>(p: string, json: unknown) => request<{ data: T }>(p, { method: 'PATCH', json }).then((r) => r.data),
  del: <T>(p: string) => request<{ data: T }>(p, { method: 'DELETE' }).then((r) => r.data),
  upload: <T>(p: string, form: FormData) => request<{ data: T }>(p, { method: 'POST', body: form }).then((r) => r.data),
};

/** Map server field errors onto react-hook-form. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void) {
  if (err instanceof ApiError) for (const [k, v] of Object.entries(err.fields)) setError(k as never, { message: v });
}

export const errorMessage = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

// ---------- shared response types ----------
export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
}
export interface Membership {
  orgId: string;
  name: string;
  role: string;
  onboardingComplete: boolean;
}
