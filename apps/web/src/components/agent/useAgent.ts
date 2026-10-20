import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ToolCatalogEntry, ToolMode } from '@closewell/shared';
import { api } from '../../lib/api';
import { useOrgId } from '../../lib/org';

export interface QualificationQuestion {
  key: string;
  question: string;
  kind: 'text' | 'budget' | 'timeline' | 'need' | 'authority' | 'contact';
  required: boolean;
  weight: number;
}
export interface AgentConfig {
  name: string;
  persona: { displayName: string; tone: string; language: string; introduction: string };
  strategy: string;
  goals: string[];
  qualificationQuestions: QualificationQuestion[];
  scoring: { qualifiedThreshold: number; budgetMinimum: number | null; timelineMaxDays: number | null };
  policies: {
    autoDiscountEnabled: boolean;
    maxAutoDiscountPercent: number;
    escalationKeywords: string[];
    maxAiTurnsBeforeHandoff: number;
    businessRules: string[];
    restrictedTopics: string[];
    approvalExpiryHours: number;
  };
  tools: Record<string, ToolMode>;
}
export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  step: number;
}
export interface AgentDetail {
  id: string;
  status: 'draft' | 'published' | 'disabled';
  config: AgentConfig;
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  lastSimulationAt: string | null;
  effectiveToolModes: Record<string, ToolMode>;
  readiness: ReadinessCheck[];
  provider: { id: string; label: string; mode: 'mock' | 'live' | 'not_configured'; model: string };
}

/** Loads the org's (first) agent and keeps an editable draft of its config. */
export function useAgent() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['agents', orgId], queryFn: () => api.get<{ id: string }[]>(`/orgs/${orgId}/agents`) });
  const agentId = list.data?.[0]?.id;
  const detail = useQuery({ queryKey: ['agent', orgId, agentId], queryFn: () => api.get<AgentDetail>(`/orgs/${orgId}/agents/${agentId}`), enabled: !!agentId });
  const tools = useQuery({ queryKey: ['agent-tools', orgId], queryFn: () => api.get<{ tools: ToolCatalogEntry[] }>(`/orgs/${orgId}/agents/tools`), staleTime: Infinity });
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  useEffect(() => {
    if (detail.data && !draft) setDraft(structuredClone(detail.data.config));
  }, [detail.data, draft]);
  const save = useMutation({
    mutationFn: (cfg: AgentConfig) => api.put(`/orgs/${orgId}/agents/${agentId}/config`, cfg),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['agent', orgId, agentId] });
      setDraft(null);
    },
  });
  const dirty = !!draft && !!detail.data && JSON.stringify(draft) !== JSON.stringify(detail.data.config);
  return { orgId, agentId, detail, tools, draft, setDraft, save, dirty, isLoading: list.isLoading || detail.isLoading, error: list.error ?? detail.error };
}

export function update<T>(obj: T, mut: (d: T) => void): T {
  const c = structuredClone(obj);
  mut(c);
  return c;
}
