import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Hand, Inbox as InboxIcon, Pause, Play, Search, StickyNote, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { StringList } from '../../components/agent/Sections';
import { flagLabel } from '../../components/agent/Playground';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Spinner, Textarea, cx, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, humanize, relTime } from '../../lib/format';
import { useCan, useOrgId } from '../../lib/org';

interface Conv {
  id: string;
  channel: string;
  status: 'open' | 'closed';
  aiMode: 'ai' | 'paused' | 'human';
  assignedTo: string | null;
  escalated: boolean;
  escalationReason: string;
  tags: string[];
  summary: string;
  suggestedNextAction: string;
  contact: { name: string; email: string; phone: string };
  leadId: string | null;
  lastActivityAt: string;
  lastMessagePreview: string;
}
interface Msg {
  id: string;
  kind: 'message' | 'note' | 'event';
  role: 'customer' | 'ai' | 'human' | 'system';
  content: string;
  meta: { flags?: string[]; mock?: boolean; automated?: boolean; sources?: string[] };
  authorName?: string;
  createdAt: string;
}
interface Detail extends Conv {
  assignee: { id: string; name: string } | null;
  messages: Msg[];
  lead: { id: string; name: string; email: string; phone: string; company: string; score: number; stageKey: string; requirements: string; budget?: { amount: number | null } } | null;
  approvals: { id: string; tool: string; summary: string; status: string }[];
}

const MODE: Record<Conv['aiMode'], { label: string; tone: 'pine' | 'ochre' | 'brand' }> = {
  ai: { label: 'AI replying', tone: 'pine' },
  paused: { label: 'AI paused', tone: 'ochre' },
  human: { label: 'Team handling', tone: 'brand' },
};
const name = (c: Pick<Conv, 'contact'>) => c.contact?.name || c.contact?.email || 'Website visitor';

export default function Inbox() {
  const orgId = useOrgId();
  const { conversationId } = useParams();
  const [filters, setFilters] = useState({ status: 'open', mode: '', escalated: false, q: '', mine: false });
  const params = new URLSearchParams({ status: filters.status, pageSize: '50' });
  if (filters.mode) params.set('aiMode', filters.mode);
  if (filters.escalated) params.set('escalated', 'true');
  if (filters.q) params.set('q', filters.q);
  if (filters.mine) params.set('assignedTo', 'me');
  const list = useQuery({ queryKey: ['conversations', orgId, params.toString()], queryFn: () => api.list<Conv>(`/orgs/${orgId}/conversations?${params}`), refetchInterval: 10_000 });

  return (
    <div className="mx-auto max-w-7xl">
      <div className={cx('grid gap-4 lg:grid-cols-[340px_1fr]', conversationId && 'max-lg:[&>*:first-child]:hidden')}>
        <section aria-label="Conversations" className="flex min-h-0 flex-col rounded-xl border border-line bg-surface">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <h1 className="text-lg font-bold">Inbox</h1>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted" aria-hidden />
              <Input aria-label="Search conversations" className="pl-8" placeholder="Search name, email, message" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select aria-label="Status" className="h-8 w-auto text-xs" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </Select>
              <Select aria-label="Who is replying" className="h-8 w-auto text-xs" value={filters.mode} onChange={(e) => setFilters({ ...filters, mode: e.target.value })}>
                <option value="">Anyone replying</option>
                <option value="ai">AI replying</option>
                <option value="paused">AI paused</option>
                <option value="human">Team handling</option>
              </Select>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={filters.escalated} onChange={(e) => setFilters({ ...filters, escalated: e.target.checked })} /> Needs a person</label>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} /> Assigned to me</label>
            </div>
          </div>
          <div className="max-h-[calc(100vh-260px)] min-h-64 overflow-y-auto">
            {list.isLoading && <div className="px-4"><Spinner /></div>}
            {list.isError && <div className="p-3"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
            {list.data?.data.length === 0 && (
              <div className="p-4 text-sm text-muted">
                <InboxIcon className="mb-2 size-5" aria-hidden />
                No conversations match. Conversations from your website chat appear here as soon as a visitor writes.
              </div>
            )}
            <ul>
              {list.data?.data.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/${orgId}/inbox/${c.id}`} aria-current={c.id === conversationId ? 'page' : undefined} className={cx('block border-b border-line px-4 py-3 hover:bg-sunken', c.id === conversationId && 'bg-brand-soft')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{name(c)}</p>
                      <span className="shrink-0 text-xs text-muted">{relTime(c.lastActivityAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">{c.lastMessagePreview || 'No messages yet'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={MODE[c.aiMode].tone}>{MODE[c.aiMode].label}</Badge>
                      {c.escalated && <Badge tone="ochre">Needs a person</Badge>}
                      {c.status === 'closed' && <Badge>Closed</Badge>}
                      {c.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {conversationId ? <ConversationView key={conversationId} id={conversationId} /> : (
          <div className="hidden lg:block">
            <EmptyState icon={<InboxIcon className="size-6" />} title="Select a conversation">Open a conversation to read it, take over from the AI, or add a note for your team.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationView({ id }: { id: string }) {
  const orgId = useOrgId();
  const can = useCan();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const key = ['conversation', orgId, id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Detail>(`/orgs/${orgId}/conversations/${id}`), refetchInterval: 5000 });
  const refresh = () => (qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['conversations', orgId] }));
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/orgs/${orgId}/conversations/${id}/${path}`, body),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'brick'),
  });
  const patch = useMutation({ mutationFn: (body: unknown) => api.patch(`/orgs/${orgId}/conversations/${id}`, body), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'brick') });
  const send = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/conversations/${id}/${mode === 'note' ? 'notes' : 'messages'}`, { content: text }),
    onSuccess: () => (setText(''), refresh()),
    onError: (e) => toast(errorMessage(e), 'brick'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const canReply = can('conversations:reply');
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_300px]">
      <section aria-label="Conversation" className="flex min-w-0 flex-col rounded-xl border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <button className="rounded-lg p-1.5 hover:bg-sunken lg:hidden" aria-label="Back to list" onClick={() => nav(`/app/${orgId}/inbox`)}><ArrowLeft className="size-4" /></button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{name(c)}</h2>
            <p className="text-xs text-muted">{c.channel === 'web' ? 'Website chat' : humanize(c.channel)} · {c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned'}</p>
          </div>
          <Badge tone={MODE[c.aiMode].tone}>{MODE[c.aiMode].label}</Badge>
          {canReply && c.status === 'open' && (
            <div className="flex flex-wrap gap-2">
              {c.aiMode !== 'human' && <Button size="sm" onClick={() => action.mutate({ path: 'takeover' })}><Hand className="size-4" /> Take over</Button>}
              {c.aiMode === 'ai' && <Button size="sm" variant="secondary" onClick={() => action.mutate({ path: 'pause' })}><Pause className="size-4" /> Pause AI</Button>}
              {c.aiMode !== 'ai' && <Button size="sm" variant="secondary" onClick={() => action.mutate({ path: 'resume', body: { replyNow: false } })}><Play className="size-4" /> Resume AI</Button>}
            </div>
          )}
        </header>
        {c.escalated && c.status === 'open' && <p className="border-b border-line bg-ochre-soft px-4 py-2 text-sm text-ochre">Needs a person: {c.escalationReason || 'escalated'}</p>}
        <ol className="flex max-h-[calc(100vh-330px)] min-h-72 flex-col gap-3 overflow-y-auto bg-sunken/60 p-4" aria-live="polite">
          {c.messages.map((m) => <TimelineItem key={m.id} m={m} />)}
        </ol>
        {canReply && (
          <form className="border-t border-line p-3" onSubmit={(e) => (e.preventDefault(), text.trim() && send.mutate())}>
            <div className="mb-2 flex gap-1 text-sm" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'reply'} className={cx('rounded-md px-2.5 py-1', mode === 'reply' ? 'bg-brand-soft font-medium text-brand' : 'text-muted')} onClick={() => setMode('reply')}>Reply to customer</button>
              <button type="button" role="tab" aria-selected={mode === 'note'} className={cx('rounded-md px-2.5 py-1', mode === 'note' ? 'bg-ochre-soft font-medium text-ochre' : 'text-muted')} onClick={() => setMode('note')}><StickyNote className="mr-1 inline size-3.5" />Internal note</button>
            </div>
            <div className="flex gap-2">
              <label htmlFor="composer" className="sr-only">{mode === 'reply' ? 'Reply' : 'Note'}</label>
              <Textarea id="composer" rows={2} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder={mode === 'reply' ? (c.aiMode === 'human' ? 'Write a reply…' : 'Replying takes over from the AI…') : 'Only your team can see notes'} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && send.mutate()} />
              <Button type="submit" variant={mode === 'note' ? 'secondary' : 'primary'} loading={send.isPending} disabled={!text.trim() || (mode === 'reply' && c.status === 'closed')}>{mode === 'reply' ? 'Send' : 'Add note'}</Button>
            </div>
          </form>
        )}
      </section>
      <aside className="flex flex-col gap-4">
        <section className="rounded-xl border border-line bg-surface p-4 text-sm">
          <h3 className="font-semibold">Summary</h3>
          <p className="mt-1 text-muted">{c.summary || 'A summary appears after the first AI reply.'}</p>
          {c.suggestedNextAction && (<><h3 className="mt-3 font-semibold">Suggested next step</h3><p className="mt-1 text-muted">{c.suggestedNextAction}</p></>)}
          <p className="mt-3 text-xs text-muted">AI-written. Check it against the conversation.</p>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 text-sm">
          <h3 className="font-semibold">Lead</h3>
          {c.lead ? (
            <div className="mt-2 space-y-1">
              <p><Link className="font-medium text-brand underline" to={`/app/${orgId}/leads/${c.lead.id}`}>{c.lead.name || c.lead.email || 'Unnamed lead'}</Link></p>
              {c.lead.company && <p className="text-muted">{c.lead.company}</p>}
              {c.lead.email && <p className="text-muted">{c.lead.email}</p>}
              <p className="text-muted">Stage: {humanize(c.lead.stageKey)} · Score {c.lead.score}</p>
              {c.lead.requirements && <p className="text-muted">Needs: {c.lead.requirements}</p>}
            </div>
          ) : (
            <p className="mt-1 text-muted">{c.leadId ? 'Linked to a lead you cannot view.' : 'No lead yet. One is created when the customer shares details.'}</p>
          )}
        </section>
        {c.approvals.length > 0 && (
          <section className="rounded-xl border border-line bg-surface p-4 text-sm">
            <h3 className="font-semibold">Approval requests</h3>
            <ul className="mt-2 space-y-2">
              {c.approvals.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2"><span>{a.summary}</span><Badge tone={a.status === 'pending' ? 'ochre' : a.status === 'executed' || a.status === 'approved' ? 'pine' : 'neutral'}>{humanize(a.status)}</Badge></li>
              ))}
            </ul>
            <Link to={`/app/${orgId}/approvals`} className="mt-2 inline-block text-brand underline">Open approvals</Link>
          </section>
        )}
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
          <StringList label="Tags" items={c.tags} disabled={!canReply} onChange={(tags) => patch.mutate({ tags })} placeholder="e.g. pricing" />
          {canReply && (
            <div className="flex flex-wrap gap-2">
              {c.assignedTo !== user?.id && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ assignedTo: user!.id })}><UserRound className="size-4" /> Assign to me</Button>}
              {c.status === 'open' ? <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: 'closed' })}>Close conversation</Button> : <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: 'open' })}>Reopen</Button>}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function TimelineItem({ m }: { m: Msg }) {
  if (m.kind === 'event') return <li className="text-center text-xs text-muted">{m.content} · {relTime(m.createdAt)}</li>;
  if (m.kind === 'note')
    return (
      <li className="mx-auto w-full max-w-xl rounded-lg border border-ochre/30 bg-ochre-soft px-3 py-2 text-sm">
        <p className="text-xs font-semibold text-ochre">Note from {m.authorName ?? 'team'} · {relTime(m.createdAt)}</p>
        <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
      </li>
    );
  const customer = m.role === 'customer';
  const flags = m.meta?.flags ?? [];
  return (
    <li className={cx('flex flex-col gap-1', customer ? 'items-start' : 'items-end')}>
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
        {m.role === 'ai' && <Bot className="size-3.5" aria-hidden />}
        {customer ? 'Customer' : m.role === 'ai' ? (m.meta?.mock ? 'AI (mock)' : 'AI') : m.authorName ?? 'Team'} · <time dateTime={m.createdAt} title={dateTime(m.createdAt)}>{relTime(m.createdAt)}</time>
      </p>
      <p className={cx('max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm', customer ? 'rounded-bl-md border border-line bg-surface' : m.role === 'ai' ? 'rounded-br-md bg-brand-soft' : 'rounded-br-md bg-brand text-brand-ink')}>{m.content}</p>
      {flags.length > 0 && <div className="flex flex-wrap justify-end gap-1">{flags.map((f) => <Badge key={f} tone="ochre">{flagLabel(f)}</Badge>)}</div>}
    </li>
  );
}
