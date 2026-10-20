import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SALES_STRATEGIES, TONES, type ToolCatalogEntry, type ToolMode } from '@closewell/shared';
import { Badge, Button, Checkbox, Field, Input, Select, Textarea, cx } from '../ui';
import { update, type AgentConfig, type QualificationQuestion } from './useAgent';

type P = { cfg: AgentConfig; onChange: (c: AgentConfig) => void; disabled?: boolean };

/** Editable list of short strings (goals, keywords, rules). */
export function StringList({ label, hint, items, onChange, placeholder, disabled, max = 20 }: { label: string; hint?: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean; max?: number }) {
  const [value, setValue] = useState('');
  const add = () => {
    const v = value.trim();
    if (v && !items.includes(v) && items.length < max) onChange([...items, v]);
    setValue('');
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={hint}>
        <div className="flex gap-2">
          <Input value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <Button type="button" variant="secondary" onClick={add} disabled={disabled || !value.trim()}>Add</Button>
        </div>
      </Field>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((it) => (
            <li key={it} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-1 text-sm">
              {it}
              {!disabled && (
                <button type="button" aria-label={`Remove ${it}`} className="text-muted hover:text-brick" onClick={() => onChange(items.filter((x) => x !== it))}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PersonaSection({ cfg, onChange, disabled }: P) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Assistant name" hint="Shown to customers in the chat.">
        <Input value={cfg.persona.displayName} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.persona.displayName = e.target.value)))} />
      </Field>
      <Field label="Internal name">
        <Input value={cfg.name} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.name = e.target.value)))} />
      </Field>
      <Field label="Tone">
        <Select value={cfg.persona.tone} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.persona.tone = e.target.value)))}>
          {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </Select>
      </Field>
      <Field label="Language" hint="The agent switches if the customer writes in another language.">
        <Input value={cfg.persona.language} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.persona.language = e.target.value)))} />
      </Field>
      <Field label="How it introduces itself (optional)" className="sm:col-span-2">
        <Textarea rows={2} value={cfg.persona.introduction} disabled={disabled} placeholder="e.g. Mention that we offer a free site survey." onChange={(e) => onChange(update(cfg, (c) => (c.persona.introduction = e.target.value)))} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium">Sales approach</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SALES_STRATEGIES.map((s) => (
            <label key={s.id} className={cx('flex cursor-pointer gap-3 rounded-lg border p-3 text-sm', cfg.strategy === s.id ? 'border-brand bg-brand-soft' : 'border-line')}>
              <input type="radio" name="strategy" className="mt-0.5 accent-[var(--brand)]" disabled={disabled} checked={cfg.strategy === s.id} onChange={() => onChange(update(cfg, (c) => (c.strategy = s.id)))} />
              <span>
                <span className="block font-medium">{s.label}</span>
                <span className="text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <StringList label="Conversation goals" hint="What a good conversation achieves, in your words." items={cfg.goals} max={10} disabled={disabled} placeholder="e.g. Book a free site survey" onChange={(v) => onChange(update(cfg, (c) => (c.goals = v)))} />
      </div>
    </div>
  );
}

const KINDS: QualificationQuestion['kind'][] = ['need', 'budget', 'timeline', 'authority', 'contact', 'text'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 40) || 'question';

export function QualificationSection({ cfg, onChange, disabled }: P) {
  const qs = cfg.qualificationQuestions;
  const set = (i: number, patch: Partial<QualificationQuestion>) => onChange(update(cfg, (c) => Object.assign(c.qualificationQuestions[i], patch)));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {qs.length === 0 && <p className="text-sm text-muted">No questions yet. Add the things your team always needs to know before following up.</p>}
        {qs.map((q, i) => (
          <div key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_140px_100px_auto]">
            <Field label={`Question ${i + 1}`}>
              <Input value={q.question} disabled={disabled} onChange={(e) => set(i, { question: e.target.value, key: q.key || slug(e.target.value) })} />
            </Field>
            <Field label="Type">
              <Select value={q.kind} disabled={disabled} onChange={(e) => set(i, { kind: e.target.value as QualificationQuestion['kind'] })}>
                {KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Weight" hint="0–40">
              <Input type="number" min={0} max={40} value={q.weight} disabled={disabled} onChange={(e) => set(i, { weight: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
            </Field>
            <div className="flex items-end">
              <Button type="button" variant="ghost" aria-label={`Remove question ${i + 1}`} disabled={disabled} onClick={() => onChange(update(cfg, (c) => c.qualificationQuestions.splice(i, 1)))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || qs.length >= 15}
            onClick={() => onChange(update(cfg, (c) => c.qualificationQuestions.push({ key: `question_${Date.now().toString(36).slice(-4)}`, question: '', kind: 'text', required: false, weight: 10 })))}
          >
            <Plus className="size-4" /> Add question
          </Button>
        </div>
      </div>
      <div className="rounded-lg bg-sunken p-4">
        <h3 className="text-sm font-semibold">Lead score rules</h3>
        <p className="mt-1 text-sm text-muted">
          The score (0–100) is a checklist of what you know about a lead, not a prediction of whether they will buy. Qualification answers are worth up to 40 points (by weight), contact details 15, described requirements 15, budget 15 and timeline 15.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Qualified at score" hint="Used for the Qualified filter.">
            <Input type="number" min={0} max={100} value={cfg.scoring.qualifiedThreshold} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.scoring.qualifiedThreshold = Math.max(0, Math.min(100, Number(e.target.value) || 0)))))} />
          </Field>
          <Field label="Minimum budget (optional)" hint="Below this, the budget rule earns 0.">
            <Input type="number" min={0} value={cfg.scoring.budgetMinimum ?? ''} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.scoring.budgetMinimum = e.target.value === '' ? null : Math.max(0, Number(e.target.value)))))} />
          </Field>
          <Field label="Max timeline in days (optional)" hint="Longer timelines earn fewer points.">
            <Input type="number" min={1} value={cfg.scoring.timelineMaxDays ?? ''} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.scoring.timelineMaxDays = e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))))))} />
          </Field>
        </div>
      </div>
    </div>
  );
}

const MODE_LABEL: Record<ToolMode, string> = { auto: 'Automatic', approval: 'Needs approval', disabled: 'Off' };
const CAT: Record<string, { tone: 'pine' | 'ochre' | 'brick'; label: string }> = { A: { tone: 'pine', label: 'Low risk' }, B: { tone: 'ochre', label: 'Controlled' }, C: { tone: 'brick', label: 'Sensitive' } };

export function RulesSection({ cfg, onChange, tools, disabled }: P & { tools: ToolCatalogEntry[] }) {
  const pol = cfg.policies;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold">Discounts</h3>
        <div className="mt-3 flex flex-col gap-3">
          <Checkbox
            label="Let the agent offer small discounts on its own"
            hint="Anything above the limit always goes to the approval queue."
            checked={pol.autoDiscountEnabled}
            disabled={disabled}
            onChange={(e) => onChange(update(cfg, (c) => (c.policies.autoDiscountEnabled = e.target.checked)))}
          />
          {pol.autoDiscountEnabled && (
            <Field label="Automatic limit (%)" hint="Maximum 50%." className="max-w-48">
              <Input type="number" min={0} max={50} value={pol.maxAutoDiscountPercent} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.policies.maxAutoDiscountPercent = Math.max(0, Math.min(50, Number(e.target.value) || 0)))))} />
            </Field>
          )}
        </div>
      </section>
      <section className="grid gap-6 sm:grid-cols-2">
        <StringList label="Hand off to the team when the customer mentions" items={pol.escalationKeywords} disabled={disabled} placeholder="e.g. complaint" max={30} onChange={(v) => onChange(update(cfg, (c) => (c.policies.escalationKeywords = v)))} />
        <StringList label="Topics the agent must not discuss" items={pol.restrictedTopics} disabled={disabled} placeholder="e.g. competitor pricing" max={30} onChange={(v) => onChange(update(cfg, (c) => (c.policies.restrictedTopics = v)))} />
        <div className="sm:col-span-2">
          <StringList label="Business rules" hint="Plain-language rules, e.g. “We only install within 50 km of Ahmedabad.”" items={pol.businessRules} disabled={disabled} max={30} onChange={(v) => onChange(update(cfg, (c) => (c.policies.businessRules = v)))} />
        </div>
        <Field label="Hand off after this many AI replies" hint="0 means no limit.">
          <Input type="number" min={0} max={200} value={pol.maxAiTurnsBeforeHandoff} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.policies.maxAiTurnsBeforeHandoff = Math.max(0, Math.round(Number(e.target.value) || 0)))))} />
        </Field>
        <Field label="Approval requests expire after (hours)">
          <Input type="number" min={1} max={720} value={pol.approvalExpiryHours} disabled={disabled} onChange={(e) => onChange(update(cfg, (c) => (c.policies.approvalExpiryHours = Math.max(1, Math.min(720, Math.round(Number(e.target.value) || 1))))))} />
        </Field>
      </section>
      <section>
        <h3 className="text-sm font-semibold">What the agent may do</h3>
        <p className="mt-1 text-sm text-muted">Sensitive actions can never be fully automatic. The server enforces these settings on every action.</p>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {tools.map((t) => {
            const mode = (cfg.tools[t.name] ?? t.defaultMode) as ToolMode;
            return (
              <li key={t.name} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_11rem]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.label}
                    <Badge tone={CAT[t.category].tone}>{CAT[t.category].label}</Badge>
                    {t.comingSoon && <Badge>Not available yet</Badge>}
                  </p>
                  <p className="text-sm text-muted">{t.description}</p>
                </div>
                <Select aria-label={`${t.label} permission`} className="w-full" value={mode} disabled={disabled || t.allowedModes.length < 2} onChange={(e) => onChange(update(cfg, (c) => (c.tools[t.name] = e.target.value as ToolMode)))}>
                  {t.allowedModes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </Select>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
