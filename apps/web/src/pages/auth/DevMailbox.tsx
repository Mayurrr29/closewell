import { useQuery } from '@tanstack/react-query';
import { Logo } from '../../components/Brand';
import { EmptyState, ErrorState, Notice, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';

/** Development only: emails captured while EMAIL_MODE=mock. The API refuses this in production. */
export default function DevMailbox() {
  const q = useQuery({ queryKey: ['dev-mailbox'], queryFn: () => api.get<{ id: string; to: string; subject: string; text: string; createdAt: string }[]>('/dev/mailbox'), refetchInterval: 5000 });
  const linkify = (t: string) => t.split(/(https?:\/\/\S+)/g).map((p, i) => (/^https?:/.test(p) ? <a key={i} className="break-all text-brand underline" href={p}>{p}</a> : p));
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Logo />
      <h1 className="mt-8 text-2xl font-bold">Dev mailbox</h1>
      <div className="mt-3">
        <Notice tone="ochre">Email is in mock mode: nothing below was delivered. This page exists only on development servers.</Notice>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {q.isLoading && <Spinner />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState title="No emails yet">Register an account or invite a teammate and the email will appear here.</EmptyState>}
        {q.data?.map((m) => (
          <article key={m.id} className="rounded-xl border border-line bg-surface p-4">
            <p className="text-sm font-semibold">{m.subject}</p>
            <p className="text-xs text-muted">To {m.to} · {dateTime(m.createdAt)}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{linkify(m.text)}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
