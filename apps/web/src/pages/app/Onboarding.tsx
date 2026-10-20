import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, MessageCircle, Phone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PersonaSection, QualificationSection, RulesSection } from '../../components/agent/Sections';
import { Playground } from '../../components/agent/Playground';
import { useAgent } from '../../components/agent/useAgent';
import { OrgProfileForm } from '../../components/OrgProfileForm';
import { ProductForm } from '../../components/ProductForm';
import { WidgetSettings } from '../../components/WidgetSettings';
import { Badge, Button, ErrorState, Field, Input, Notice, Spinner, Textarea, cx, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { useOrg, useOrgId } from '../../lib/org';

const STEPS = ['Business profile', 'Products and FAQs', 'Agent identity', 'Qualification', 'Sales rules', 'Channel', 'Test conversation', 'Publish'];

export default function Onboarding() {
  const orgId = useOrgId();
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const done = org.data?.onboarding.completedSteps ?? [];
  const firstOpen = STEPS.findIndex((_, i) => !done.includes(i + 1)) + 1 || 8;
  const step = Math.min(8, Math.max(1, Number(params.get('step')) || firstOpen));
  const go = (n: number) => setParams({ step: String(n) });
  const complete = async (n: number) => {
    await api.post(`/orgs/${orgId}/onboarding/steps/${n}`);
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
    if (n < 8) go(n + 1);
  };
  if (org.isLoading) return <Spinner />;
  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Setup steps">
        <ol className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const isDone = done.includes(n);
            return (
              <li key={s}>
                <button onClick={() => go(n)} aria-current={step === n ? 'step' : undefined} className={cx('flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-sm', step === n ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-sunken')}>
                  <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', isDone ? 'bg-pine text-white' : step === n ? 'bg-brand text-brand-ink' : 'bg-sunken text-muted')}>{isDone ? <Check className="size-3.5" aria-label="done" /> : n}</span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand">Step {step} of 8</p>
        {step === 1 && (
          <StepFrame title="Business profile" text="The agent treats this as verified fact about your business.">
            <OrgProfileForm defaults={{ ...org.data!, industry: org.data!.industry as never }} submitLabel="Save and continue" onSubmit={async (v) => (await api.patch(`/orgs/${orgId}`, v), await complete(1))} />
          </StepFrame>
        )}
        {step === 2 && <ProductsStep orgId={orgId} currency={org.data!.currency} onNext={() => complete(2)} />}
        {step >= 3 && step <= 5 && <AgentStep step={step} onNext={() => complete(step)} />}
        {step === 6 && (
          <StepFrame title="Choose a channel" text="Where customers will talk to your agent.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border-2 border-brand bg-surface p-4">
                <MessageCircle className="size-5 text-brand" aria-hidden />
                <p className="mt-2 font-semibold">Website chat</p>
                <p className="text-sm text-muted">Available now</p>
              </div>
              {[{ i: MessageCircle, n: 'WhatsApp' }, { i: Phone, n: 'Phone calls' }].map(({ i: I, n }) => (
                <div key={n} className="rounded-xl border border-line bg-surface p-4 opacity-70">
                  <I className="size-5 text-muted" aria-hidden />
                  <p className="mt-2 font-semibold">{n}</p>
                  <p className="text-sm text-muted">Not available yet</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-line bg-surface p-5">
              <WidgetSettings orgId={orgId} canManage compact onSaved={() => complete(6)} />
            </div>
          </StepFrame>
        )}
        {step === 7 && <TestStep onNext={() => complete(7)} />}
        {step === 8 && <PublishStep goTo={go} />}
      </div>
    </div>
  );
}

function StepFrame({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <p className="prose-measure mt-1 text-muted">{text}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ProductsStep({ orgId, currency, onNext }: { orgId: string; currency: string; onNext: () => Promise<void> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const products = useQuery({ queryKey: ['products', orgId, 'onboarding'], queryFn: () => api.list<{ id: string; name: string; price: number | null; currency?: string; pricingModel: string }>(`/orgs/${orgId}/products?pageSize=50`) });
  const [faq, setFaq] = useState({ question: '', answer: '' });
  const addFaq = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/knowledge/text`, { title: `FAQ: ${faq.question.slice(0, 80)}`, type: 'faq', faqs: [faq] }),
    onSuccess: () => (setFaq({ question: '', answer: '' }), toast('FAQ added')),
  });
  const count = products.data?.meta.total ?? 0;
  return (
    <StepFrame title="Products and FAQs" text="Add what you sell with real prices. The agent can only quote what is here. You can import a CSV or add documents later.">
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="rounded-xl border border-line bg-surface p-5">
          <ProductForm compact currency={currency} submitLabel="Add product" onSubmit={async (v) => (await api.post(`/orgs/${orgId}/products`, v), await qc.invalidateQueries({ queryKey: ['products', orgId] }), toast('Product added'))} />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Added ({count})</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {count === 0 && <li className="px-4 py-3 text-muted">Nothing yet.</li>}
            {products.data?.data.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 px-4 py-2.5">
                <span className="truncate">{p.name}</span>
                <span className="text-muted">{p.pricingModel === 'quote_only' ? 'Quote' : money(p.price, p.currency || currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Frequently asked questions</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (faq.question.trim().length >= 3 && faq.answer.trim()) addFaq.mutate();
          }}
        >
          <Field label="Question"><Input value={faq.question} onChange={(e) => setFaq({ ...faq, question: e.target.value })} /></Field>
          <Field label="Answer"><Textarea rows={1} value={faq.answer} onChange={(e) => setFaq({ ...faq, answer: e.target.value })} /></Field>
          <div><Button type="submit" variant="secondary" loading={addFaq.isPending} disabled={faq.question.trim().length < 3 || !faq.answer.trim()}>Add FAQ</Button></div>
        </form>
        {addFaq.isError && <div className="mt-3"><ErrorState error={addFaq.error} /></div>}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={() => void onNext()}>Continue</Button>
        {count === 0 && <span className="text-sm text-muted">Add at least one product or FAQ before publishing.</span>}
      </div>
    </StepFrame>
  );
}

function AgentStep({ step, onNext }: { step: number; onNext: () => Promise<void> }) {
  const a = useAgent();
  if (a.isLoading || !a.draft) return <Spinner />;
  if (a.error) return <ErrorState error={a.error} />;
  const meta = {
    3: ['Agent identity', 'How your agent introduces itself, sounds and sells.'],
    4: ['Qualification', 'The questions the agent works into the conversation, and how leads are scored.'],
    5: ['Sales rules and approvals', 'Limits the agent must respect, and which actions need a person.'],
  }[step as 3 | 4 | 5];
  return (
    <StepFrame title={meta[0]} text={meta[1]}>
      <div className="rounded-xl border border-line bg-surface p-5">
        {step === 3 && <PersonaSection cfg={a.draft} onChange={a.setDraft} />}
        {step === 4 && <QualificationSection cfg={a.draft} onChange={a.setDraft} />}
        {step === 5 && <RulesSection cfg={a.draft} onChange={a.setDraft} tools={a.tools.data?.tools ?? []} />}
      </div>
      {a.save.isError && <div className="mt-4"><ErrorState error={new Error(errorMessage(a.save.error))} /></div>}
      <div className="mt-6">
        <Button loading={a.save.isPending} onClick={async () => (a.dirty ? await a.save.mutateAsync(a.draft!) : undefined, await onNext())}>Save and continue</Button>
      </div>
    </StepFrame>
  );
}

function TestStep({ onNext }: { onNext: () => Promise<void> }) {
  const a = useAgent();
  const [ran, setRan] = useState(false);
  if (a.isLoading || !a.detail.data) return <Spinner />;
  return (
    <StepFrame title="Test conversation" text="Chat with your draft agent. Check that answers, prices and approvals behave the way you expect.">
      <Playground orgId={a.orgId} agentId={a.agentId!} providerMode={a.detail.data.provider.mode} onRan={() => setRan(true)} />
      <div className="mt-6">
        <Button disabled={!ran && !a.detail.data.lastSimulationAt} onClick={() => void onNext()}>Looks right, continue</Button>
      </div>
    </StepFrame>
  );
}

function PublishStep({ goTo }: { goTo: (n: number) => void }) {
  const a = useAgent();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const publish = useMutation({
    mutationFn: () => api.post(`/orgs/${a.orgId}/agents/${a.agentId}/publish`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast('Agent published');
      nav(`/app/${a.orgId}`);
    },
  });
  if (a.isLoading || !a.detail.data) return <Spinner />;
  const checks = a.detail.data.readiness;
  const ready = checks.every((c) => c.ok);
  return (
    <StepFrame title="Publish your agent" text="Publishing makes your current settings live on the channels you enabled. Later edits stay in draft until you publish again.">
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex items-center gap-2.5">
              {c.ok ? <Check className="size-4 text-pine" aria-label="done" /> : <Circle className="size-4 text-muted" aria-label="to do" />}
              {c.label}
            </span>
            {!c.ok && <Button variant="secondary" size="sm" onClick={() => goTo(c.step)}>Go to step {c.step}</Button>}
          </li>
        ))}
      </ul>
      {!user?.emailVerified && <div className="mt-4"><Notice tone="ochre">Verify your email address before publishing. The banner at the top of the page can resend the link.</Notice></div>}
      {a.detail.data.provider.mode !== 'live' && (
        <div className="mt-4">
          <Notice tone="ochre" title={a.detail.data.provider.mode === 'mock' ? 'This server uses the mock AI' : 'AI provider not configured'}>
            Customers would get rule-based replies, not language-model replies, until an administrator sets an OpenAI key on the server.
          </Notice>
        </div>
      )}
      {publish.isError && <div className="mt-4"><ErrorState error={new Error(errorMessage(publish.error))} /></div>}
      <div className="mt-6 flex items-center gap-3">
        <Button size="lg" disabled={!ready || !user?.emailVerified} loading={publish.isPending} onClick={() => publish.mutate()}>Publish agent</Button>
        {a.detail.data.status === 'published' && <Badge tone="pine">Published v{a.detail.data.publishedVersion}</Badge>}
        <Link to={`/app/${a.orgId}`} className="text-sm text-muted underline">Finish later</Link>
      </div>
    </StepFrame>
  );
}
