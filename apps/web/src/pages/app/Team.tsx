import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLE_LABELS, assignableRoles, type OrgRole } from '@closewell/shared';
import { Badge, Button, ErrorState, Field, Input, Notice, PageHeader, Panel, Select, Spinner, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';
import { useMembers } from './Leads';

export default function Team() {
  const orgId = useOrgId();
  const can = useCan();
  const org = useOrg();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(orgId);
  const manage = can('members:manage');
  const invites = useQuery({ queryKey: ['invites', orgId], queryFn: () => api.get<{ id: string; email: string; role: string; expiresAt: string; expired: boolean }[]>(`/orgs/${orgId}/invitations`), enabled: manage });
  const myRole = (org.data?.role ?? 'analyst') as OrgRole;
  const roles = assignableRoles(myRole);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('sales_rep');
  const onErr = (e: unknown) => toast(errorMessage(e), 'brick');
  const refresh = () => (qc.invalidateQueries({ queryKey: ['members', orgId] }), qc.invalidateQueries({ queryKey: ['invites', orgId] }));
  const invite = useMutation({ mutationFn: () => api.post<{ emailMode: string }>(`/orgs/${orgId}/invitations`, { email, role }), onSuccess: (r) => (setEmail(''), refresh(), toast(r.emailMode === 'mock' ? 'Invitation created. Email is in mock mode: find the link in the dev mailbox.' : 'Invitation sent')) });
  const change = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => api.patch(`/orgs/${orgId}/members/${id}`, { role: r }), onSuccess: () => (refresh(), toast('Role updated')), onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/orgs/${orgId}/members/${id}`), onSuccess: () => (refresh(), toast('Member removed')), onError: onErr });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/orgs/${orgId}/invitations/${id}`), onSuccess: refresh, onError: onErr });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Team" description="Sales reps see leads assigned to them and unassigned leads. Analysts can read but not change anything." />
      {manage && (
        <Panel title="Invite a teammate" className="mb-6">
          {!user?.emailVerified ? <Notice tone="ochre">Verify your email address before inviting people.</Notice> : (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => (e.preventDefault(), invite.mutate())}>
              <Field label="Email" className="min-w-56 flex-1"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                  {roles.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </Field>
              <Button type="submit" loading={invite.isPending} disabled={!email}>Send invitation</Button>
            </form>
          )}
          {invite.isError && <div className="mt-3"><ErrorState error={new Error(errorMessage(invite.error))} /></div>}
        </Panel>
      )}
      <Panel title="Members" padded={false}>
        {members.isLoading ? <div className="px-5"><Spinner /></div> : (
          <ul className="divide-y divide-line">
            {members.data?.map((m) => {
              const editable = manage && m.userId !== user?.id && roles.includes(m.role as OrgRole);
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.name} {m.userId === user?.id && <span className="text-muted">(you)</span>}</p>
                    <p className="text-sm text-muted">{m.email}</p>
                  </div>
                  {editable ? (
                    <>
                      <Select aria-label={`Role for ${m.name}`} className="w-52" value={m.role} onChange={(e) => change.mutate({ id: m.userId, r: e.target.value })}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </Select>
                      <Button variant="ghost" size="sm" className="text-brick" onClick={() => remove.mutate(m.userId)}>Remove</Button>
                    </>
                  ) : <Badge>{ROLE_LABELS[m.role as OrgRole]}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {manage && !!invites.data?.length && (
        <Panel title="Pending invitations" padded={false} className="mt-6">
          <ul className="divide-y divide-line">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1">{i.email} · {ROLE_LABELS[i.role as OrgRole]}</span>
                <span className="text-muted">{i.expired ? 'Expired' : `Expires ${dateTime(i.expiresAt)}`}</span>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
