import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import type { z } from 'zod';
import { INDUSTRIES, orgProfileSchema } from '@closewell/shared';
import { applyFieldErrors, errorMessage } from '../lib/api';
import { Button, ErrorState, Field, Input, Select, Textarea } from './ui';

type Values = z.input<typeof orgProfileSchema>;

// Some browsers list legacy names (e.g. Asia/Calcutta). Always include current canonical names and the user's own zone.
const COMMON_ZONES = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Ho_Chi_Minh', 'Europe/Kyiv', 'America/New_York', 'Europe/London'];
const TIMEZONES: string[] = (() => {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    /* older browsers */
  }
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([...list, ...COMMON_ZONES, ...(own ? [own] : [])])].sort();
})();

export function OrgProfileForm({ defaults, submitLabel, onSubmit }: { defaults?: Partial<Values>; submitLabel: string; onSubmit: (v: Values) => Promise<unknown> }) {
  const [error, setError] = useState('');
  const f = useForm<Values>({
    resolver: zodResolver(orgProfileSchema),
    defaultValues: { industry: 'other', currency: 'USD', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', website: '', ...defaults },
  });
  const e = f.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={f.handleSubmit(async (v) => {
        setError('');
        try {
          await onSubmit(v);
        } catch (err) {
          applyFieldErrors(err, f.setError as never);
          setError(errorMessage(err));
        }
      })}
    >
      {error && <div className="sm:col-span-2"><ErrorState error={new Error(error)} /></div>}
      <Field label="Business name" error={e.name?.message} className="sm:col-span-2">
        <Input {...f.register('name')} />
      </Field>
      <Field label="Industry" error={e.industry?.message}>
        <Select {...f.register('industry')}>
          {INDUSTRIES.map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Website" hint="Used for importing pages into the knowledge base." error={e.website?.message}>
        <Input type="url" placeholder="https://example.com" {...f.register('website')} />
      </Field>
      <Field label="Country" error={e.country?.message}>
        <Input autoComplete="country-name" {...f.register('country')} />
      </Field>
      <Field label="Currency" hint="3-letter code, e.g. USD, INR, EUR" error={e.currency?.message}>
        <Input maxLength={3} className="uppercase" {...f.register('currency')} />
      </Field>
      <Field label="Timezone" error={e.timezone?.message} className="sm:col-span-2">
        <Select {...f.register('timezone')}>
          {TIMEZONES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </Field>
      <Field label="What does the business do?" hint="The agent uses this as a verified fact about you. Be specific and accurate." error={e.description?.message} className="sm:col-span-2">
        <Textarea rows={4} {...f.register('description')} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={f.formState.isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
