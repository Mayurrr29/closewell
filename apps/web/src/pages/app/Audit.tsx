import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { EmptyState, ErrorState, Pagination, PageHeader, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime, humanize } from '../../lib/format';
import { useOrgId } from '../../lib/org';

interface Entry { id: string; action: string; actor: { type: string; label?: string }; target?: { type: string; id?: string }; meta: Record<string, unknown>; createdAt: string }

export default function Audit() {
  const orgId = useOrgId();
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const q = useQuery({ queryKey: ['audit', orgId, page, actor], queryFn: () => api.list<Entry>(`/orgs/${orgId}/audit?page=${page}&pageSize=50${actor ? `&actorType=${actor}` : ''}`) });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Audit log"
        description="Configuration changes, approvals, exports, escalations and other important actions."
        actions={
          <Select aria-label="Actor" className="w-40" value={actor} onChange={(e) => (setActor(e.target.value), setPage(1))}>
            <option value="">Everyone</option>
            <option value="user">Team members</option>
            <option value="ai">AI agent</option>
            <option value="system">System</option>
            <option value="customer">Customers</option>
          </Select>
        }
      />
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.data.length === 0 && <EmptyState title="No entries">Actions appear here as your team and agent work.</EmptyState>}
      {!!q.data?.data.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">Who</th><th className="px-4 py-2.5 font-medium">Action</th><th className="px-4 py-2.5 font-medium">Details</th></tr></thead>
            <tbody>
              {q.data.data.map((e) => (
                <tr key={e.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{dateTime(e.createdAt)}</td>
                  <td className="px-4 py-2.5">{e.actor.label ?? humanize(e.actor.type)}</td>
                  <td className="px-4 py-2.5">{humanize(e.action.replace('.', ' '))}</td>
                  <td className="max-w-xs px-4 py-2.5 text-xs text-muted">{Object.entries(e.meta ?? {}).map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} onPage={setPage} />}
    </div>
  );
}
