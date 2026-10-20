import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, request, setAccessToken, setSessionLostHandler, type Membership, type User } from './api';

interface AuthState {
  status: 'loading' | 'signed_in' | 'signed_out';
  user: User | null;
  memberships: Membership[];
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  const signedOut = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setMemberships([]);
    setStatus('signed_out');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setSessionLostHandler(signedOut);
    refreshSession().then((r) => {
      if (!r) return signedOut();
      setUser(r.user);
      setMemberships(r.memberships);
      setStatus('signed_in');
    });
  }, [signedOut]);

  const accept = (d: { accessToken: string; user: User; memberships: Membership[] }) => {
    setAccessToken(d.accessToken);
    setUser(d.user);
    setMemberships(d.memberships);
    setStatus('signed_in');
  };

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      memberships,
      async login(email, password) {
        accept(await api.post('/auth/login', { email, password }));
      },
      async register(name, email, password) {
        accept(await api.post('/auth/register', { name, email, password }));
      },
      async logout() {
        await request('/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'closewell' } }).catch(() => undefined);
        signedOut();
      },
      async reload() {
        // Refresh so the new access token carries current claims (e.g. email verified).
        const r = await refreshSession();
        if (r) {
          setUser(r.user);
          setMemberships(r.memberships);
        }
      },
    }),
    [status, user, memberships, signedOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
