import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, EmptyState, ErrorState, Input, Pagination, PageHeader, Select, Spinner, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, humanize, relTime } from '../../lib/format';
import { useCan, useOrgId } from '../../lib/org';

interface Approval {
  id: string;
  tool: string;
  category: 'A' | 'B' | 'C';
  args: Record<string, unknown>;
  summary: string;
  reason: string;
  status: string;
  conversationId: string | null;
  leadId: string | null;
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote?: string;
  expiresAt: string;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'ochre' | 'pine' | 'brick' | 'neutral' | 'brand'> = { pending: 'ochre', approved: 'brand', executing: 'brand', executed: 'pine', rejected: 'neutral', expired: 'neutral', failed: 'brick' };

export default function Approvals() {
  const orgId = useOrgId();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['approvals', orgId, status, page], queryFn: () => api.list<Approval>(`/orgs/${orgId}/approvals?status=${status}&page=${page}`), refetchInterval: 15_000 });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'retry' }) => api.post(`/orgs/${orgId}/approvals/${id}/${action}`, action === 'retry' ? {} : { note: notes[id] || undefined }),
    onSuccess: (_d, v) => (qc.invalidateQueries({ queryKey: ['approvals', orgId] }), qc.invalidateQueries({ queryKey: ['approvals-count', orgId] }), toast(v.action === 'approve' ? 'Approved. The action runs now.' : v.action === 'reject' ? 'Rejected' : 'Retrying')),
    onError: (e) => (toast(errorMessage(e), 'brick'), qc.invalidateQueries({ queryKey: ['approvals', orgId] })),
  });
  const canDecide = can('approvals:decide');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Approvals"
        description="Actions the agent wanted to take but is not allowed to do alone. Nothing here has been promised to the customer."
        actions={
          <Select aria-label="Status" className="w-44" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            {['pending', 'executed', 'rejected', 'expired', 'failed', 'all'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        }
      />
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.data.length === 0 && <EmptyState icon={<CheckCircle2 className="size-6" />} title={status === 'pending' ? 'Nothing waiting for you' : 'No requests'}>{status === 'pending' ? 'When the agent asks for a discount above your limit, custom terms or a quotation, it appears here.' : 'Try another status.'}</EmptyState>}
      <ul className="flex flex-col gap-3">
        {q.data?.data.map((a) => (
          <li key={a.id} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{a.summary}</p>
                <p className="mt-0.5 text-sm text-muted">{humanize(a.tool)} · requested {relTime(a.createdAt)}{a.status === 'pending' && ` · expires ${dateTime(a.expiresAt)}`}</p>
              </div>
              <div className="flex gap-1.5">
                {a.category === 'C' && <Badge tone="brick">Sensitive</Badge>}
                <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{humanize(a.status)}</Badge>
              </div>
            </div>
            {a.reason && <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm"><span className="text-muted">Why the agent asked: </span>{a.reason}</p>}
            {a.error && <p className="mt-2 text-sm text-brick">Failed: {a.error}</p>}
            {a.decidedBy && <p className="mt-2 text-sm text-muted">{humanize(a.status)} by {a.decidedBy.name} {relTime(a.decidedAt)}{a.decisionNote && `: “${a.decisionNote}”`}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {a.conversationId && <Link className="text-sm text-brand underline" to={`/app/${orgId}/inbox/${a.conversationId}`}>Open conversation</Link>}
              {a.leadId && <Link className="text-sm text-brand underline" to={`/app/${orgId}/leads/${a.leadId}`}>Open lead</Link>}
            </div>
            {canDecide && a.status === 'pending' && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <Input aria-label="Decision note" className="min-w-48 flex-1" placeholder="Note for the audit log (optional)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                <Button variant="approve" loading={decide.isPending && decide.variables?.id === a.id && decide.variables.action === 'approve'} onClick={() => decide.mutate({ id: a.id, action: 'approve' })}>Approve</Button>
                <Button variant="secondary" loading={decide.isPending && decide.variables?.id === a.id && decide.variables.action === 'reject'} onClick={() => decide.mutate({ id: a.id, action: 'reject' })}>Reject</Button>
              </div>
            )}
            {canDecide && a.status === 'failed' && <div className="mt-4"><Button variant="secondary" onClick={() => decide.mutate({ id: a.id, action: 'retry' })}>Retry</Button></div>}
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} onPage={setPage} />}
    </div>
  );
}
