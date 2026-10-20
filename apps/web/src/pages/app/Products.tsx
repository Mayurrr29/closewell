import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ProductForm, type ProductValues } from '../../components/ProductForm';
import { Badge, Button, Dialog, EmptyState, ErrorState, Input, Notice, Pagination, PageHeader, Spinner, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';

interface Product extends ProductValues {
  id: string;
  updatedAt: string;
}

export default function Products() {
  const orgId = useOrgId();
  const can = useCan();
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: { row: number; message: string }[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cur = org.data?.currency ?? 'USD';
  const list = useQuery({ queryKey: ['products', orgId, q, page], queryFn: () => api.list<Product>(`/orgs/${orgId}/products?page=${page}&q=${encodeURIComponent(q)}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['products', orgId] });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/orgs/${orgId}/products/${id}`), onSuccess: () => (refresh(), setEditing(null), toast('Product deleted')), onError: (e) => toast(errorMessage(e), 'brick') });
  const imp = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.upload<{ created: number; errors: { row: number; message: string }[] }>(`/orgs/${orgId}/products/import`, fd);
    },
    onSuccess: (r) => (setImportResult(r), refresh()),
    onError: (e) => toast(errorMessage(e), 'brick'),
  });
  const write = can('products:write');

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Products and services"
        description="The agent quotes these prices exactly and will not mention anything that is not listed. Inactive items are hidden from the agent."
        actions={
          write && (
            <>
              <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && imp.mutate(e.target.files[0])} />
              <Button variant="secondary" loading={imp.isPending} onClick={() => file.current?.click()}><Upload className="size-4" /> Import CSV</Button>
              <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add product</Button>
            </>
          )
        }
      />
      {importResult && (
        <div className="mb-4">
          <Notice tone={importResult.errors.length ? 'ochre' : 'pine'} title={`Imported ${importResult.created} item${importResult.created === 1 ? '' : 's'}`}>
            {importResult.errors.length > 0 && <ul className="mt-1 list-disc pl-5">{importResult.errors.slice(0, 8).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
            <button className="mt-1 underline" onClick={() => setImportResult(null)}>Dismiss</button>
          </Notice>
        </div>
      )}
      <div className="relative mb-4 w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted" aria-hidden />
        <Input aria-label="Search products" className="pl-8" placeholder="Search by name" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
      </div>
      {list.isLoading && <Spinner />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data?.data.length === 0 && (
        <EmptyState icon={<Package className="size-6" />} title={q ? 'No products match' : 'No products yet'} action={write && !q && <Button onClick={() => setEditing('new')}>Add your first product</Button>}>
          {q ? 'Try a different search.' : 'Add products or services with their prices, or import a CSV with columns: name, kind, description, price, currency, price_unit, pricing_model, availability, sku, tags.'}
        </EmptyState>
      )}
      {!!list.data?.data.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Price</th><th className="px-4 py-2.5 font-medium">Availability</th><th className="px-4 py-2.5 font-medium">Status</th></tr></thead>
            <tbody>
              {list.data.data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <button className="text-left font-medium hover:text-brand" onClick={() => setEditing(p)}>{p.name}</button>
                    <p className="line-clamp-1 text-xs text-muted">{p.kind === 'service' ? 'Service' : 'Product'}{p.description ? ` · ${p.description}` : ''}</p>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{p.pricingModel === 'quote_only' ? <span className="text-muted">Quote only</span> : <>{p.pricingModel === 'starting_at' && 'from '}{money(p.price ?? null, p.currency || cur)}{p.priceUnit && <span className="text-muted"> {p.priceUnit}</span>}</>}</td>
                  <td className="px-4 py-2.5">{p.availability === 'available' ? 'Available' : <Badge tone={p.availability === 'unavailable' ? 'brick' : 'ochre'}>{p.availability}</Badge>}</td>
                  <td className="px-4 py-2.5">{p.active ? <Badge tone="pine">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onPage={setPage} />}
      <Dialog wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add product' : 'Edit product'}>
        {editing && (
          <>
            <ProductForm
              key={editing === 'new' ? 'new' : editing.id}
              currency={cur}
              defaults={editing === 'new' ? undefined : editing}
              onSubmit={async (v) => {
                if (editing === 'new') await api.post(`/orgs/${orgId}/products`, v);
                else await api.patch(`/orgs/${orgId}/products/${editing.id}`, v);
                await refresh();
                toast(editing === 'new' ? 'Product added' : 'Product saved');
                setEditing(null);
              }}
            />
            {editing !== 'new' && write && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button variant="secondary" onClick={() => api.patch(`/orgs/${orgId}/products/${editing.id}`, { active: !editing.active }).then(() => (refresh(), setEditing(null)))}>{editing.active ? 'Deactivate' : 'Activate'}</Button>
                <Button variant="secondary" className="text-brick" loading={del.isPending} onClick={() => del.mutate(editing.id)}>Delete product</Button>
              </div>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
