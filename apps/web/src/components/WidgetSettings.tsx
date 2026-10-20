import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { StringList } from './agent/Sections';
import { Button, Checkbox, ErrorState, Field, Input, Select, Spinner, Textarea, useToast } from './ui';

export interface WidgetConfig {
  publicKey: string;
  enabled: boolean;
  agentId: string | null;
  agentStatus: string | null;
  brandName: string;
  greeting: string;
  primaryColor: string;
  position: 'left' | 'right';
  allowedDomains: string[];
  collectContact: 'off' | 'optional' | 'before_chat';
  businessHours: { enabled: boolean; timezone: string; days: number[]; start: string; end: string; offlineMessage: string };
  snippet: string;
  scriptUrl: string;
}

export function useWidget(orgId: string) {
  return useQuery({ queryKey: ['widget', orgId], queryFn: () => api.get<WidgetConfig>(`/orgs/${orgId}/widget`) });
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WidgetSettings({ orgId, canManage, compact, onSaved }: { orgId: string; canManage: boolean; compact?: boolean; onSaved?: () => void }) {
  const q = useWidget(orgId);
  const qc = useQueryClient();
  const toast = useToast();
  const [w, setW] = useState<WidgetConfig | null>(null);
  useEffect(() => {
    if (q.data) setW(structuredClone(q.data));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: WidgetConfig) =>
      api.put<WidgetConfig>(`/orgs/${orgId}/widget`, {
        enabled: v.enabled,
        agentId: v.agentId,
        brandName: v.brandName,
        greeting: v.greeting,
        primaryColor: v.primaryColor,
        position: v.position,
        allowedDomains: v.allowedDomains,
        collectContact: v.collectContact,
        businessHours: v.businessHours,
      }),
    onSuccess: (d) => {
      qc.setQueryData(['widget', orgId], d);
      toast('Website chat settings saved');
      onSaved?.();
    },
  });
  if (q.isLoading || !w) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const set = (patch: Partial<WidgetConfig>) => setW({ ...w, ...patch });
  const dis = !canManage;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(w);
      }}
    >
      {save.isError && <ErrorState error={new Error(errorMessage(save.error))} />}
      <StringList
        label="Websites allowed to show the chat"
        hint="Domain only, like example.com. Use *.example.com for subdomains, or localhost:3000 for local testing."
        items={w.allowedDomains}
        disabled={dis}
        onChange={(v) => set({ allowedDomains: v })}
        placeholder="example.com"
      />
      <Checkbox label="Chat is live on these websites" hint="Turn off to hide the chat everywhere. You can still preview it here." checked={w.enabled} disabled={dis} onChange={(e) => set({ enabled: e.target.checked })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name shown in the chat header">
          <Input value={w.brandName} disabled={dis} onChange={(e) => set({ brandName: e.target.value })} />
        </Field>
        <Field label="Brand colour">
          <div className="flex gap-2">
            <input type="color" aria-label="Pick colour" className="h-10 w-12 rounded-lg border border-line bg-surface" value={w.primaryColor} disabled={dis} onChange={(e) => set({ primaryColor: e.target.value })} />
            <Input value={w.primaryColor} disabled={dis} onChange={(e) => set({ primaryColor: e.target.value })} />
          </div>
        </Field>
        <Field label="Greeting" className="sm:col-span-2">
          <Textarea rows={2} value={w.greeting} disabled={dis} onChange={(e) => set({ greeting: e.target.value })} />
        </Field>
        {!compact && (
          <>
            <Field label="Position">
              <Select value={w.position} disabled={dis} onChange={(e) => set({ position: e.target.value as 'left' | 'right' })}>
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </Select>
            </Field>
            <Field label="Ask for contact details">
              <Select value={w.collectContact} disabled={dis} onChange={(e) => set({ collectContact: e.target.value as WidgetConfig['collectContact'] })}>
                <option value="optional">Offer a contact form</option>
                <option value="before_chat">Require before chatting</option>
                <option value="off">Never</option>
              </Select>
            </Field>
          </>
        )}
      </div>
      {!compact && (
        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium">Team hours</legend>
          <Checkbox label="Show when the team is offline" hint="The AI answers at any time; this changes what customers are told when they ask for a person." checked={w.businessHours.enabled} disabled={dis} onChange={(e) => set({ businessHours: { ...w.businessHours, enabled: e.target.checked } })} />
          {w.businessHours.enabled && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Timezone"><Input value={w.businessHours.timezone} disabled={dis} onChange={(e) => set({ businessHours: { ...w.businessHours, timezone: e.target.value } })} /></Field>
              <Field label="From"><Input type="time" value={w.businessHours.start} disabled={dis} onChange={(e) => set({ businessHours: { ...w.businessHours, start: e.target.value } })} /></Field>
              <Field label="Until"><Input type="time" value={w.businessHours.end} disabled={dis} onChange={(e) => set({ businessHours: { ...w.businessHours, end: e.target.value } })} /></Field>
              <div className="flex flex-wrap gap-2 sm:col-span-3" role="group" aria-label="Days">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-sm">
                    <input type="checkbox" disabled={dis} checked={w.businessHours.days.includes(i)} onChange={(e) => set({ businessHours: { ...w.businessHours, days: e.target.checked ? [...w.businessHours.days, i].sort() : w.businessHours.days.filter((x) => x !== i) } })} />
                    {d}
                  </label>
                ))}
              </div>
              <Field label="Message when offline" className="sm:col-span-3"><Textarea rows={2} value={w.businessHours.offlineMessage} disabled={dis} onChange={(e) => set({ businessHours: { ...w.businessHours, offlineMessage: e.target.value } })} /></Field>
            </div>
          )}
        </fieldset>
      )}
      {canManage && (
        <div>
          <Button type="submit" loading={save.isPending}>Save website chat</Button>
        </div>
      )}
    </form>
  );
}
