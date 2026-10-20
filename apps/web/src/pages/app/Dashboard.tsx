import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, EmptyState, ErrorState, Notice, PageHeader, Skeleton, cx } from '../../components/ui';
import { api } from '../../lib/api';
import { humanize, money } from '../../lib/format';
import { useOrg, useOrgId } from '../../lib/org';

interface Overview {
  range: { from: string; to: string };
  currency: string;
  metrics: Record<string, number | null>;
  series: { date: string; leads: number; conversations: number; won: number }[];
  byChannel: Record<string, { conversations: number; escalated: number }>;
  bySource: Record<string, number>;
  definitions: Record<string, string>;
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function Stat({ label, value, definition, to, emphasis }: { label: string; value: string; definition: string; to?: string; emphasis?: boolean }) {
  const [show, setShow] = useState(false);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        <button type="button" className="rounded p-0.5 text-muted hover:text-ink" aria-label={`What “${label}” means`} aria-expanded={show} onClick={(e) => (e.preventDefault(), setShow((s) => !s))}>
          <Info className="size-3.5" />
        </button>
      </div>
      <p className={cx('mt-1 font-bold tracking-tight tabular-nums', emphasis ? 'text-4xl' : 'text-3xl')}>{value}</p>
      {show && <p className="mt-2 text-xs leading-relaxed text-muted">{definition}</p>}
    </>
  );
  const cls = 'block rounded-xl border border-line bg-surface p-4';
  return to ? <Link to={to} className={cx(cls, 'hover:border-brand')}>{body}</Link> : <div className={cls}>{body}</div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{new Date(label!).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
      {payload.map((p) => (
        <p key={p.name} className="mt-1 flex items-center gap-2 text-ink">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-semibold tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const orgId = useOrgId();
  const org = useOrg();
  const [days, setDays] = useState(30);
  const [table, setTable] = useState(false);
  const q = useQuery({
    queryKey: ['overview', orgId, days],
    queryFn: () => api.get<Overview>(`/orgs/${orgId}/analytics/overview?from=${new Date(Date.now() - days * 86400_000).toISOString()}`),
  });
  const m = q.data?.metrics;
  const d = q.data?.definitions ?? {};
  const cur = q.data?.currency ?? org.data?.currency ?? 'USD';
  const hasSeries = !!q.data?.series.some((s) => s.leads || s.conversations);
  const onboardingDone = !!org.data?.onboarding.completedAt;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description="Numbers come from your stored records only. Test conversations are excluded."
        actions={
          <div role="radiogroup" aria-label="Date range" className="flex rounded-lg border border-line bg-surface p-1 text-sm">
            {RANGES.map((r) => (
              <button key={r.days} role="radio" aria-checked={days === r.days} onClick={() => setDays(r.days)} className={cx('rounded-md px-3 py-1', days === r.days ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink')}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      {!onboardingDone && (
        <div className="mb-6">
          <Notice tone="brand" title="Finish setting up your agent">
            Your agent is not live yet. <Link className="font-semibold underline" to="onboarding">Continue setup</Link>
          </Notice>
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      {m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Leads" value={String(m.total_leads)} definition={d.total_leads} to="leads" emphasis />
            <Stat label="Qualified leads" value={String(m.qualified_leads)} definition={d.qualified_leads} />
            <Stat label="Won deals" value={String(m.won_deals)} definition={d.won_deals} />
            <Stat label="Recorded revenue" value={money(m.recorded_revenue, cur)} definition={d.recorded_revenue} />
            <Stat label="Open conversations" value={String(m.active_conversations)} definition={d.active_conversations} to="inbox" />
            <Stat label="Conversion rate" value={m.conversion_rate === null ? '—' : `${(m.conversion_rate * 100).toFixed(1)}%`} definition={d.conversion_rate} />
            <Stat label="AI replies" value={String(m.ai_messages)} definition={d.ai_messages} />
            <Stat
              label="Estimated AI cost"
              value={m.ai_cost === null ? 'Unknown' : `$${m.ai_cost.toFixed(m.ai_cost < 1 ? 4 : 2)}`}
              definition={`${d.ai_cost}${m.ai_cost_unpriced_runs ? ` ${m.ai_cost_unpriced_runs} replies used a model with no configured price.` : ''}`}
            />
          </div>
          {!!m.pending_approvals && (
            <div className="mt-4">
              <Notice tone="ochre">
                {m.pending_approvals} {m.pending_approvals === 1 ? 'request is' : 'requests are'} waiting for approval. <Link to="approvals" className="font-semibold underline">Review now</Link>
              </Notice>
            </div>
          )}

          <section className="mt-8 rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Leads and conversations per day</h2>
              {hasSeries && (
                <button className="text-sm text-muted underline underline-offset-2 hover:text-ink" onClick={() => setTable((t) => !t)}>
                  {table ? 'Show chart' : 'Show as table'}
                </button>
              )}
            </div>
            {!hasSeries ? (
              <div className="mt-4">
                <EmptyState title="No activity in this period">
                  Daily activity will appear here once customers start chatting. Publish your agent and add the chat to your website to get started.
                </EmptyState>
              </div>
            ) : table ? (
              <div className="mt-4 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted"><tr><th className="py-1.5 font-medium">Date</th><th className="font-medium">Leads</th><th className="font-medium">Conversations</th><th className="font-medium">Won</th></tr></thead>
                  <tbody className="tabular-nums">
                    {q.data!.series.filter((s) => s.leads || s.conversations || s.won).map((s) => (
                      <tr key={s.date} className="border-t border-line"><td className="py-1.5">{s.date}</td><td>{s.leads}</td><td>{s.conversations}</td><td>{s.won}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <ul className="mt-3 flex gap-4 text-sm" aria-label="Legend">
                  <li className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-[var(--series-1)]" aria-hidden />Leads</li>
                  <li className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-[var(--series-2)]" aria-hidden />Conversations</li>
                </ul>
                <div className="mt-2 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={q.data!.series} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }} />
                      <Line type="monotone" dataKey="leads" name="Leads" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
                      <Line type="monotone" dataKey="conversations" name="Conversations" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <section className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-base font-semibold">By channel</h2>
              {Object.keys(q.data!.byChannel).length === 0 ? (
                <p className="mt-3 text-sm text-muted">No conversations in this period.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Channel</th><th className="font-medium">Conversations</th><th className="font-medium">Handed to team</th></tr></thead>
                  <tbody className="tabular-nums">
                    {Object.entries(q.data!.byChannel).map(([ch, v]) => (
                      <tr key={ch} className="border-t border-line"><td className="py-1.5">{ch === 'web' ? 'Website chat' : humanize(ch)}</td><td>{v.conversations}</td><td>{v.escalated}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-base font-semibold">Lead sources</h2>
              {Object.keys(q.data!.bySource).length === 0 ? (
                <p className="mt-3 text-sm text-muted">No leads in this period.</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(q.data!.bySource).map(([s, n]) => <li key={s}><Badge>{humanize(s)}: {n}</Badge></li>)}
                </ul>
              )}
              {!!m.guarded_replies && <p className="mt-4 text-sm text-muted">{m.guarded_replies} AI replies triggered a safety check in this period. Review them in the inbox.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
