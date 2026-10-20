import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LayoutGrid, List, Plus, Search, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Pagination, PageHeader, Select, Spinner, Textarea, cx, useToast } from '../../components/ui';
import { api, errorMessage, request } from '../../lib/api';
import { money, relTime } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  score: number;
  stageKey: string;
  stageType: string;
  dealValue: number | null;
  assignedTo: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
}
export interface Stage { key: string; name: string; type: 'open' | 'won' | 'lost'; count: number }
export interface Member { userId: string; name: string; email: string; role: string }

export const usePipeline = (orgId: string) => useQuery({ queryKey: ['pipeline', orgId], queryFn: () => api.get<Stage[]>(`/orgs/${orgId}/pipeline`) });
export const useMembers = (orgId: string) => useQuery({ queryKey: ['members', orgId], queryFn: () => api.get<Member[]>(`/orgs/${orgId}/members`) });

export function ScoreBadge({ score }: { score: number }) {
  return <span className="inline-flex min-w-9 justify-center rounded-md bg-sunken px-1.5 py-0.5 text-xs font-semibold tabular-nums" title="Rule-based fit score (0–100). Not a prediction.">{score}</span>;
}

export default function Leads() {
  const orgId = useOrgId();
  const org = useOrg();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ q: '', stage: '', assignedTo: '', sort: 'recent' });
  const [creating, setCreating] = useState(false);
  const stages = usePipeline(orgId);
  const members = useMembers(orgId);
  const params = new URLSearchParams({ page: String(page), pageSize: view === 'board' ? '100' : '25', sort: f.sort });
  if (f.q) params.set('q', f.q);
  if (f.stage) params.set('stage', f.stage);
  if (f.assignedTo) params.set('assignedTo', f.assignedTo);
  const leads = useQuery({ queryKey: ['leads', orgId, params.toString()], queryFn: () => api.list<Lead>(`/orgs/${orgId}/leads?${params}`) });
  const memberName = (id: string | null) => members.data?.find((m) => m.userId === id)?.name ?? '';
  const stageName = (k: string) => stages.data?.find((s) => s.key === k)?.name ?? k;
  const cur = org.data?.currency ?? 'USD';

  const exportCsv = async () => {
    try {
      const res = await request<Response>(`/orgs/${orgId}/leads/export.csv?${params}`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `leads-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorMessage(e), 'brick');
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Leads"
        description="Lead scores are a rule-based checklist of what you know about a lead, not a prediction of whether they will buy."
        actions={
          <>
            {can('leads:export') && <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>}
            {(can('leads:write:all') || can('leads:write:assigned')) && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Add lead</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted" aria-hidden />
          <Input aria-label="Search leads" className="pl-8" placeholder="Name, email, company, phone" value={f.q} onChange={(e) => (setF({ ...f, q: e.target.value }), setPage(1))} />
        </div>
        {view === 'list' && (
          <Select aria-label="Stage" className="w-auto" value={f.stage} onChange={(e) => (setF({ ...f, stage: e.target.value }), setPage(1))}>
            <option value="">All stages</option>
            {stages.data?.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </Select>
        )}
        {can('leads:read:all') && (
          <Select aria-label="Assigned to" className="w-auto" value={f.assignedTo} onChange={(e) => (setF({ ...f, assignedTo: e.target.value }), setPage(1))}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
        )}
        <Select aria-label="Sort" className="w-auto" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="recent">Newest</option>
          <option value="score">Highest score</option>
          <option value="updated">Recently updated</option>
          <option value="followup">Next follow-up</option>
        </Select>
        <div className="ml-auto flex rounded-lg border border-line bg-surface p-1" role="radiogroup" aria-label="View">
          <button role="radio" aria-checked={view === 'list'} className={cx('rounded-md p-1.5', view === 'list' && 'bg-sunken')} onClick={() => setView('list')} aria-label="List view"><List className="size-4" /></button>
          <button role="radio" aria-checked={view === 'board'} className={cx('rounded-md p-1.5', view === 'board' && 'bg-sunken')} onClick={() => setView('board')} aria-label="Pipeline board"><LayoutGrid className="size-4" /></button>
        </div>
      </div>
      {leads.isLoading && <Spinner />}
      {leads.isError && <ErrorState error={leads.error} onRetry={() => leads.refetch()} />}
      {leads.data && leads.data.data.length === 0 && (
        <EmptyState icon={<UsersRound className="size-6" />} title={f.q || f.stage || f.assignedTo ? 'No leads match these filters' : 'No leads yet'}>
          {f.q || f.stage || f.assignedTo ? 'Clear a filter to see more.' : 'Leads are created when a website visitor shares their details or when the agent records what they need. You can also add one by hand.'}
        </EmptyState>
      )}
      {leads.data && leads.data.data.length > 0 && view === 'list' && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Lead</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Score</th>
                <th className="px-4 py-2.5 font-medium">Deal value</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {leads.data.data.map((l) => (
                <tr key={l.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken" onClick={() => nav(l.id)}>
                  <td className="px-4 py-2.5">
                    <Link to={l.id} className="font-medium hover:text-brand" onClick={(e) => e.stopPropagation()}>{l.name || l.email || 'Unnamed lead'}</Link>
                    <p className="text-xs text-muted">{[l.company, l.email].filter(Boolean).join(' · ') || l.source.replace('_', ' ')}</p>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone={l.stageType === 'won' ? 'pine' : l.stageType === 'lost' ? 'neutral' : 'brand'}>{stageName(l.stageKey)}</Badge></td>
                  <td className="px-4 py-2.5"><ScoreBadge score={l.score} /></td>
                  <td className="px-4 py-2.5 tabular-nums">{money(l.dealValue, cur)}</td>
                  <td className="px-4 py-2.5">{memberName(l.assignedTo) || <span className="text-muted">Unassigned</span>}</td>
                  <td className="px-4 py-2.5 text-muted">{relTime(l.lastContactAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {leads.data && leads.data.data.length > 0 && view === 'board' && <Board leads={leads.data.data} stages={stages.data ?? []} />}
      {view === 'list' && leads.data && <Pagination page={page} totalPages={leads.data.meta.totalPages} onPage={setPage} />}
      <NewLeadDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav(id)} />
    </div>
  );
}

function Board({ leads, stages }: { leads: Lead[]; stages: Stage[] }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [drag, setDrag] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ id, stageKey }: { id: string; stageKey: string }) => api.post(`/orgs/${orgId}/leads/${id}/stage`, { stageKey }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['leads', orgId] }), qc.invalidateQueries({ queryKey: ['pipeline', orgId] })),
    onError: (e) => toast(errorMessage(e), 'brick'),
  });
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {stages.map((s) => {
        const items = leads.filter((l) => l.stageKey === s.key);
        return (
          <section key={s.key} aria-label={s.name} className="flex w-64 shrink-0 flex-col rounded-xl bg-sunken p-2" onDragOver={(e) => e.preventDefault()} onDrop={() => drag && move.mutate({ id: drag, stageKey: s.key })}>
            <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">{s.name}<span className="text-xs font-normal text-muted">{items.length}</span></h2>
            <ul className="flex flex-col gap-2">
              {items.map((l) => (
                <li key={l.id} draggable onDragStart={() => setDrag(l.id)} className="rounded-lg border border-line bg-surface p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={l.id} className="font-medium hover:text-brand">{l.name || l.email || 'Unnamed lead'}</Link>
                    <ScoreBadge score={l.score} />
                  </div>
                  {l.company && <p className="text-xs text-muted">{l.company}</p>}
                  <label className="sr-only" htmlFor={`stage-${l.id}`}>Move to stage</label>
                  <select id={`stage-${l.id}`} className="mt-2 w-full rounded-md border border-line bg-surface px-1.5 py-1 text-xs" value={l.stageKey} onChange={(e) => move.mutate({ id: l.id, stageKey: e.target.value })}>
                    {stages.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function NewLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', email: '', phone: '', company: '', requirements: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post<Lead>(`/orgs/${orgId}/leads`, { ...v, source: 'manual' }),
    onSuccess: (l) => (qc.invalidateQueries({ queryKey: ['leads', orgId] }), setV({ name: '', email: '', phone: '', company: '', requirements: '' }), onClose(), onCreated(l.id)),
    onError: (e) => setFields((e as { fields?: Record<string, string> }).fields ?? {}),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Add a lead" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Add lead</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {create.isError && !Object.keys(fields).length && <div className="sm:col-span-2"><ErrorState error={create.error} /></div>}
        <Field label="Name" error={fields.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Company" error={fields.company}><Input value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} /></Field>
        <Field label="Email" error={fields.email}><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Phone" error={fields.phone}><Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="What do they need?" className="sm:col-span-2" error={fields.requirements}><Textarea rows={3} value={v.requirements} onChange={(e) => setV({ ...v, requirements: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
