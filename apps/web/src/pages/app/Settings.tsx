import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { OrgProfileForm } from '../../components/OrgProfileForm';
import { Badge, Button, ErrorState, Field, Input, PageHeader, Panel, Spinner, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { relTime } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';

export default function Settings() {
  const orgId = useOrgId();
  const org = useOrg();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState<number | null>(null);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ id: string; userAgent: string; ip: string; lastUsedAt: string; current: boolean }[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['sessions'] }), toast('Signed out that device')) });
  const retention = useMutation({ mutationFn: (d: number) => api.patch(`/orgs/${orgId}/retention`, { conversationDays: d }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['org', orgId] }), toast('Retention saved')), onError: (e) => toast(errorMessage(e), 'brick') });
  if (org.isLoading) return <Spinner />;
  const o = org.data!;
  const editable = can('org:update');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" />
      <Panel title="Business profile" description="The agent treats this as verified fact.">
        {editable ? (
          <OrgProfileForm defaults={{ ...o, industry: o.industry as never }} submitLabel="Save profile" onSubmit={async (v) => (await api.patch(`/orgs/${orgId}`, v), await qc.invalidateQueries({ queryKey: ['org', orgId] }), toast('Profile saved'))} />
        ) : <p className="text-sm text-muted">Only owners and administrators can change the profile.</p>}
      </Panel>
      <Panel title="Data retention" description="How long conversations are kept. Automatic deletion runs in a later release; until then this records your policy and you can delete leads and their conversations by hand.">
        <form className="flex items-end gap-3" onSubmit={(e) => (e.preventDefault(), retention.mutate(days ?? o.retention.conversationDays))}>
          <Field label="Keep conversations for (days)" hint="30 to 3650"><Input type="number" min={30} max={3650} disabled={!editable} value={days ?? o.retention.conversationDays} onChange={(e) => setDays(Number(e.target.value))} /></Field>
          {editable && <Button type="submit" variant="secondary" loading={retention.isPending}>Save</Button>}
        </form>
      </Panel>
      <Panel title="Your signed-in devices">
        {sessions.isError && <ErrorState error={sessions.error} />}
        <ul className="divide-y divide-line text-sm">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate">{s.userAgent || 'Unknown device'}<span className="block text-xs text-muted">Last used {relTime(s.lastUsedAt)}{s.ip && ` · network ${s.ip}`}</span></span>
              {s.current ? <Badge tone="pine">This device</Badge> : <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
