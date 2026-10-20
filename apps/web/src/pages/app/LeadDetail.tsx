import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, Check, MessageSquare, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Checkbox, Dialog, ErrorState, Field, Input, Panel, Select, Spinner, Textarea, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, humanize, money, relTime } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';
import { ScoreBadge, useMembers, usePipeline } from './Leads';

interface LeadFull {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  industry: string;
  requirements: string;
  budget: { amount: number | null; currency?: string };
  timeline: string;
  dealValue: number | null;
  assignedTo: string | null;
  score: number;
  scoreBreakdown: { rule: string; points: number; max: number; detail: string }[];
  qualificationAnswers: Record<string, string>;
  stageKey: string;
  stageType: string;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  consent: { contactAllowed: boolean; marketingAllowed: boolean; preferredChannel: string; optedOutAt: string | null; recordedAt?: string };
  isTest: boolean;
  createdAt: string;
  activities: { id: string; type: string; actor: { type: string; label?: string }; body: string; data: Record<string, unknown>; createdAt: string }[];
  reminders: { id: string; dueAt: string; note: string }[];
  conversations: { id: string; channel: string; status: string; lastActivityAt: string; summary: string; preview: string }[];
}

export default function LeadDetail() {
  const orgId = useOrgId();
  const { leadId } = useParams();
  const can = useCan();
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const key = ['lead', orgId, leadId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<LeadFull>(`/orgs/${orgId}/leads/${leadId}`) });
  const stages = usePipeline(orgId);
  const members = useMembers(orgId);
  const [form, setForm] = useState<Partial<LeadFull> | null>(null);
  const [note, setNote] = useState('');
  const [reminder, setReminder] = useState({ dueAt: '', note: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [purge, setPurge] = useState(false);
  useEffect(() => {
    if (q.data) setForm({ name: q.data.name, email: q.data.email, phone: q.data.phone, company: q.data.company, requirements: q.data.requirements, timeline: q.data.timeline, dealValue: q.data.dealValue, budget: q.data.budget });
  }, [q.data]);
  const done = () => (qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['leads', orgId] }));
  const onErr = (e: unknown) => toast(errorMessage(e), 'brick');
  const save = useMutation({ mutationFn: (body: unknown) => api.patch(`/orgs/${orgId}/leads/${leadId}`, body), onSuccess: () => (done(), toast('Lead saved')), onError: onErr });
  const stage = useMutation({ mutationFn: (stageKey: string) => api.post(`/orgs/${orgId}/leads/${leadId}/stage`, { stageKey }), onSuccess: done, onError: onErr });
  const addNote = useMutation({ mutationFn: () => api.post(`/orgs/${orgId}/leads/${leadId}/notes`, { body: note }), onSuccess: () => (setNote(''), done()), onError: onErr });
  const addReminder = useMutation({ mutationFn: () => api.post(`/orgs/${orgId}/leads/${leadId}/reminders`, { dueAt: new Date(reminder.dueAt).toISOString(), note: reminder.note }), onSuccess: () => (setReminder({ dueAt: '', note: '' }), done()), onError: onErr });
  const doneReminder = useMutation({ mutationFn: (rid: string) => api.post(`/orgs/${orgId}/leads/${leadId}/reminders/${rid}/done`), onSuccess: done, onError: onErr });
  const del = useMutation({ mutationFn: () => api.del(`/orgs/${orgId}/leads/${leadId}?purgeConversations=${purge}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['leads', orgId] }), toast('Lead deleted'), nav(`/app/${orgId}/leads`)), onError: onErr });

  if (q.isLoading || !form) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data!;
  const cur = org.data?.currency ?? 'USD';
  const canEdit = can('leads:write:all') || can('leads:write:assigned');
  const memberName = (id: string | null) => members.data?.find((m) => m.userId === id)?.name;

  return (
    <div className="mx-auto max-w-6xl">
      <Link to={`/app/${orgId}/leads`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Leads</Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{l.name || l.email || 'Unnamed lead'}</h1>
          <p className="text-sm text-muted">{humanize(l.source)} · created {dateTime(l.createdAt)} {l.isTest && <Badge tone="ochre">Test data</Badge>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="stage" className="text-sm text-muted">Stage</label>
          <Select id="stage" className="w-48" value={l.stageKey} disabled={!canEdit} onChange={(e) => stage.mutate(e.target.value)}>
            {stages.data?.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </Select>
          {can('leads:assign') && (
            <>
              <label htmlFor="owner" className="text-sm text-muted">Owner</label>
              <Select id="owner" className="w-44" value={l.assignedTo ?? ''} onChange={(e) => save.mutate({ assignedTo: e.target.value || null })}>
                <option value="">Unassigned</option>
                {members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </Select>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Panel title="Details" description="Customer-provided information is unverified." actions={canEdit && <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ ...form, budget: { amount: form.budget?.amount ?? null }, dealValue: form.dealValue ?? null })}>Save</Button>}>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['name', 'company', 'email', 'phone'] as const).map((k) => (
                <Field key={k} label={humanize(k)}><Input value={(form[k] as string) ?? ''} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
              ))}
              <Field label={`Budget (${cur})`}><Input type="number" min={0} value={form.budget?.amount ?? ''} disabled={!canEdit} onChange={(e) => setForm({ ...form, budget: { amount: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>
              <Field label="Timeline"><Input value={form.timeline ?? ''} disabled={!canEdit} placeholder="e.g. within 2 months" onChange={(e) => setForm({ ...form, timeline: e.target.value })} /></Field>
              <Field label={`Deal value (${cur})`} hint="Counted as revenue only when the lead is moved to Won."><Input type="number" min={0} value={form.dealValue ?? ''} disabled={!canEdit} onChange={(e) => setForm({ ...form, dealValue: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Requirements" className="sm:col-span-2"><Textarea rows={3} value={form.requirements ?? ''} disabled={!canEdit} onChange={(e) => setForm({ ...form, requirements: e.target.value })} /></Field>
            </div>
            {Object.keys(l.qualificationAnswers).length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Qualification answers</h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {Object.entries(l.qualificationAnswers).map(([k, v]) => (<div key={k}><dt className="text-muted">{humanize(k)}</dt><dd>{v}</dd></div>))}
                </dl>
              </div>
            )}
          </Panel>

          <Panel title="Activity">
            {canEdit && (
              <form className="mb-4 flex gap-2" onSubmit={(e) => (e.preventDefault(), note.trim() && addNote.mutate())}>
                <label htmlFor="note" className="sr-only">Add a note</label>
                <Textarea id="note" rows={2} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button type="submit" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>Add note</Button>
              </form>
            )}
            <ol className="flex flex-col gap-3 text-sm">
              {l.activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-3">
                  <p className="text-xs text-muted">{a.actor?.label ?? humanize(a.actor?.type ?? '')} · {relTime(a.createdAt)}</p>
                  <p>
                    {a.type === 'stage_change' ? <>Moved from <strong>{String(a.data.from)}</strong> to <strong>{String(a.data.to)}</strong>{a.body && `: ${a.body}`}</> : a.type === 'reminder' ? <>Reminder set for {dateTime(String(a.data.dueAt))}{a.body && `: ${a.body}`}</> : a.body || humanize(a.type)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title={<span className="flex items-center gap-2">Lead score <ScoreBadge score={l.score} /></span>} description="A checklist of what you know, not a prediction.">
            <ul className="flex flex-col gap-2 text-sm">
              {l.scoreBreakdown.map((s) => (
                <li key={s.rule}>
                  <div className="flex justify-between"><span>{s.rule}</span><span className="tabular-nums text-muted">{s.points}/{s.max}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(s.points / s.max) * 100}%` }} /></div>
                  <p className="mt-0.5 text-xs text-muted">{s.detail}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Consent">
            <div className="flex flex-col gap-3">
              <Checkbox label="May contact about this enquiry" checked={l.consent.contactAllowed} disabled={!canEdit} onChange={(e) => save.mutate({ consent: { contactAllowed: e.target.checked } })} />
              <Checkbox label="Agreed to marketing" checked={l.consent.marketingAllowed} disabled={!canEdit} onChange={(e) => save.mutate({ consent: { marketingAllowed: e.target.checked } })} />
              <p className="text-xs text-muted">{l.consent.optedOutAt ? `Opted out ${dateTime(l.consent.optedOutAt)}. ` : ''}{l.consent.recordedAt ? `Last recorded ${dateTime(l.consent.recordedAt)}.` : 'No consent recorded yet.'}</p>
            </div>
          </Panel>

          <Panel title="Reminders">
            <ul className="flex flex-col gap-2 text-sm">
              {l.reminders.length === 0 && <li className="text-muted">No open reminders.</li>}
              {l.reminders.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <span><Bell className="mr-1 inline size-3.5 text-muted" aria-hidden />{dateTime(r.dueAt)}{r.note && ` · ${r.note}`}</span>
                  {canEdit && <button className="text-muted hover:text-pine" aria-label="Mark reminder done" onClick={() => doneReminder.mutate(r.id)}><Check className="size-4" /></button>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), reminder.dueAt && addReminder.mutate())}>
                <Field label="Remind me at"><Input type="datetime-local" value={reminder.dueAt} onChange={(e) => setReminder({ ...reminder, dueAt: e.target.value })} /></Field>
                <Input aria-label="Reminder note" placeholder="Note (optional)" value={reminder.note} onChange={(e) => setReminder({ ...reminder, note: e.target.value })} />
                <Button type="submit" variant="secondary" size="sm" disabled={!reminder.dueAt} loading={addReminder.isPending}>Set reminder</Button>
              </form>
            )}
          </Panel>

          <Panel title="Conversations">
            <ul className="flex flex-col gap-2 text-sm">
              {l.conversations.length === 0 && <li className="text-muted">None linked.</li>}
              {l.conversations.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/${orgId}/inbox/${c.id}`} className="flex items-start gap-2 hover:text-brand">
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span><span className="font-medium">{c.channel === 'web' ? 'Website chat' : humanize(c.channel)}</span> · {relTime(c.lastActivityAt)}<span className="block text-muted">{c.summary || c.preview}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          {can('leads:write:all') && (
            <Button variant="secondary" className="text-brick" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Delete lead</Button>
          )}
          <p className="text-xs text-muted">Owner: {memberName(l.assignedTo) ?? 'Unassigned'} · Deal value {money(l.dealValue, cur)}</p>
        </div>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this lead?" footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep lead</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete lead</Button></>}>
        <p className="text-sm">The lead, its notes, reminders and activity are removed permanently. Use this for data-deletion requests.</p>
        <div className="mt-4"><Checkbox label="Also delete its conversations" hint="Otherwise conversations stay, with the contact details removed." checked={purge} onChange={(e) => setPurge(e.target.checked)} /></div>
      </Dialog>
    </div>
  );
}
