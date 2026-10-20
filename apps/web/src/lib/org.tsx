import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { Permission } from '@closewell/shared';
import { api } from './api';

export interface Org {
  id: string;
  name: string;
  industry: string;
  website: string;
  country: string;
  currency: string;
  timezone: string;
  description: string;
  onboarding: { completedSteps: number[]; completedAt: string | null };
  subscription: { planId: string; status: string; trialEndsAt?: string };
  retention: { conversationDays: number };
  role: string;
  permissions: Permission[];
}

export function useOrgId(): string {
  return useParams().orgId ?? '';
}

export function useOrg() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['org', orgId], queryFn: () => api.get<Org>(`/orgs/${orgId}`), enabled: !!orgId, staleTime: 30_000 });
}

/** UI-level permission check. The server enforces the same rules; this only hides controls. */
export function useCan() {
  const { data } = useOrg();
  return (p: Permission) => !!data?.permissions.includes(p);
}

export const orgPath = (orgId: string, p = '') => `/orgs/${orgId}${p}`;
