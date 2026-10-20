import { useQuery } from '@tanstack/react-query';
import { Badge, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useOrgId } from '../../lib/org';

interface Integration { id: string; name: string; mode: string; status: string; detail: string; requiredEnv: string[] }

const STATUS: Record<string, { label: string; tone: 'pine' | 'ochre' | 'neutral' | 'brick' }> = {
  connected: { label: 'Live', tone: 'pine' },
  mock: { label: 'Mock mode', tone: 'ochre' },
  needs_credentials: { label: 'Needs credentials', tone: 'brick' },
  disabled: { label: 'Off', tone: 'neutral' },
  not_built: { label: 'Not available yet', tone: 'neutral' },
};

export default function Integrations() {
  const orgId = useOrgId();
  const q = useQuery({ queryKey: ['integrations', orgId], queryFn: () => api.get<Integration[]>(`/orgs/${orgId}/integrations`) });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Integrations" description="The real status of each connection on this server. Mock mode never sends real messages, calls, emails or payments." />
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      <ul className="flex flex-col gap-3">
        {q.data?.map((i) => (
          <li key={i.id} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{i.name}</h2>
              <Badge tone={STATUS[i.status]?.tone ?? 'neutral'}>{STATUS[i.status]?.label ?? i.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{i.detail}</p>
            {i.requiredEnv.length > 0 && i.status !== 'connected' && (
              <p className="mt-2 text-xs text-muted">Server settings: {i.requiredEnv.map((e) => <code key={e} className="mr-1.5 rounded bg-sunken px-1 py-0.5">{e}</code>)}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
