import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { productSchema } from '@closewell/shared';
import { applyFieldErrors, errorMessage } from '../lib/api';
import { Button, ErrorState, Field, Input, Select, Textarea } from './ui';

export type ProductValues = z.input<typeof productSchema>;

export function ProductForm({ defaults, currency, onSubmit, submitLabel = 'Save product', compact }: { defaults?: Partial<ProductValues>; currency: string; onSubmit: (v: ProductValues) => Promise<unknown>; submitLabel?: string; compact?: boolean }) {
  const [error, setError] = useState('');
  const f = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { kind: 'product', pricingModel: 'fixed', price: null, availability: 'available', description: '', faqs: [], tags: [], active: true, currency, ...defaults },
  });
  const faqs = useFieldArray({ control: f.control, name: 'faqs' as never });
  const e = f.formState.errors;
  const model = f.watch('pricingModel');
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={f.handleSubmit(async (v) => {
        setError('');
        try {
          await onSubmit(v);
          if (!defaults) f.reset({ kind: v.kind, pricingModel: 'fixed', price: null, availability: 'available', description: '', faqs: [], tags: [], active: true, currency, name: '' });
        } catch (err) {
          applyFieldErrors(err, f.setError as never);
          setError(errorMessage(err));
        }
      })}
    >
      {error && <div className="sm:col-span-2"><ErrorState error={new Error(error)} /></div>}
      <Field label="Name" error={e.name?.message}>
        <Input {...f.register('name')} />
      </Field>
      <Field label="Type">
        <Select {...f.register('kind')}>
          <option value="product">Product</option>
          <option value="service">Service</option>
        </Select>
      </Field>
      <Field label="Pricing">
        <Select {...f.register('pricingModel')}>
          <option value="fixed">Fixed price</option>
          <option value="starting_at">Starting at</option>
          <option value="quote_only">Quote only (no list price)</option>
        </Select>
      </Field>
      {model !== 'quote_only' ? (
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <Field label="Price" hint="The agent quotes this exact amount." error={e.price?.message}>
            <Input type="number" min={0} step="0.01" inputMode="decimal" {...f.register('price', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })} />
          </Field>
          <Field label="Currency" error={e.currency?.message}>
            <Input maxLength={3} className="uppercase" {...f.register('currency')} />
          </Field>
        </div>
      ) : (
        <p className="self-end pb-2 text-sm text-muted">The agent will say pricing is quoted by the team.</p>
      )}
      {!compact && (
        <>
          <Field label="Price unit (optional)" hint="e.g. per month, per hour">
            <Input {...f.register('priceUnit')} />
          </Field>
          <Field label="Availability">
            <Select {...f.register('availability')}>
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="unavailable">Unavailable</option>
              <option value="unknown">Unknown</option>
            </Select>
          </Field>
        </>
      )}
      <Field label="Description" hint="What it is, who it's for, what's included." className="sm:col-span-2" error={e.description?.message}>
        <Textarea rows={compact ? 2 : 4} {...f.register('description')} />
      </Field>
      {!compact && (
        <div className="flex flex-col gap-3 sm:col-span-2">
          <p className="text-sm font-medium">Product FAQs</p>
          {faqs.fields.map((fld, i) => (
            <div key={fld.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Question"><Input {...f.register(`faqs.${i}.question` as const)} /></Field>
              <Field label="Answer"><Input {...f.register(`faqs.${i}.answer` as const)} /></Field>
              <div className="flex items-end">
                <Button type="button" variant="ghost" aria-label="Remove FAQ" onClick={() => faqs.remove(i)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => faqs.append({ question: '', answer: '' } as never)}><Plus className="size-4" /> Add FAQ</Button>
          </div>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={f.formState.isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
