import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPrice, type PlanDefinition } from '@closewell/shared';
import { Badge, Button, ErrorState, Notice, PageHeader, Panel, Spinner, cx, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { bytes, dateTime } from '../../lib/format';
import { useCan, useOrgId } from '../../lib/org';

interface Billing {
  plan: { id: string; name: string; interval: string };
  status: string;
  trialEndsAt?: string;
  period: string;
  paymentProvider: { status: string; message: string };
  limits: Record<string, number>;
  usage: Record<string, number>;
  plans: PlanDefinition[];
  canSwitchPlanWithoutPayment: boolean;
}

const ROWS: { key: string; label: string; fmt?: (n: number) => string }[] = [
  { key: 'ai_messages', label: 'AI replies this month' },
  { key: 'seats', label: 'Seats (members and pending invites)' },
  { key: 'agents', label: 'Agents' },
  { key: 'products', label: 'Products' },
  { key: 'knowledge_sources', label: 'Knowledge sources' },
  { key: 'knowledge_bytes', label: 'Knowledge text stored', fmt: bytes },
];

export default function BillingPage() {
  const orgId = useOrgId();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['billing', orgId], queryFn: () => api.get<Billing>(`/orgs/${orgId}/billing`) });
  const change = useMutation({ mutationFn: (planId: string) => api.post(`/orgs/${orgId}/billing/plan`, { planId }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['billing', orgId] }), toast('Plan changed (development mode, no payment)')), onError: (e) => toast(errorMessage(e), 'brick') });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title="Plan and usage" description={`Usage resets monthly (UTC). Current period: ${b.period}.`} />
      <Notice tone="ochre" title="Payments are not connected">{b.paymentProvider.message}</Notice>
      <Panel title={<span className="flex items-center gap-2">{b.plan.name} <Badge tone={b.status === 'expired' ? 'brick' : 'brand'}>{b.status}</Badge></span>} description={b.trialEndsAt ? `Trial ends ${dateTime(b.trialEndsAt)}` : undefined}>
        <ul className="flex flex-col gap-4">
          {ROWS.map((r) => {
            const used = b.usage[r.key] ?? 0;
            const limit = b.limits[r.key] ?? 0;
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
            const fmt = r.fmt ?? ((n: number) => n.toLocaleString());
            return (
              <li key={r.key}>
                <div className="flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums text-muted">{fmt(used)} of {fmt(limit)}</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-sunken" role="progressbar" aria-label={r.label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cx('h-2 rounded-full', pct >= 100 ? 'bg-brick' : pct >= 80 ? 'bg-ochre' : 'bg-brand')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-muted">Estimated AI provider cost this month: ${b.usage.estimated_ai_cost_usd.toFixed(4)} ({b.usage.ai_tokens.toLocaleString()} tokens). An estimate from your configured price table, not an invoice.</p>
      </Panel>
      <Panel title="Plans">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {b.plans.map((p) => (
            <div key={p.id} className={cx('rounded-lg border p-4', p.id === b.plan.id ? 'border-brand' : 'border-line')}>
              <p className="font-semibold">{p.name}</p>
              <p className="text-sm text-muted">{formatPrice(p.monthlyPriceCents)}{p.monthlyPriceCents ? ' / month' : ''}</p>
              <p className="mt-2 text-xs text-muted">{p.limits.ai_messages.toLocaleString()} AI replies · {p.limits.seats} seats · {p.limits.agents} agents</p>
              {p.id !== b.plan.id && b.canSwitchPlanWithoutPayment && can('billing:manage') && (
                <Button className="mt-3" size="sm" variant="secondary" loading={change.isPending && change.variables === p.id} onClick={() => change.mutate(p.id)}>Switch (dev only)</Button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Billing history: none. No payments have been taken.</p>
      </Panel>
    </div>
  );
}
