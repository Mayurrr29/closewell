import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, Globe, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Notice, Pagination, PageHeader, Panel, Spinner, Tabs, Textarea, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { bytes, relTime } from '../../lib/format';
import { useCan, useOrg, useOrgId } from '../../lib/org';

interface Source {
  id: string;
  type: 'text' | 'faq' | 'product' | 'file' | 'url' | 'catalog';
  title: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error: string | null;
  bytes: number;
  chunkCount: number;
  url?: string;
  file?: { name: string };
  updatedAt: string;
}

const STATUS = { pending: ['Queued', 'neutral'], processing: ['Processing', 'brand'], ready: ['Ready', 'pine'], failed: ['Failed', 'brick'] } as const;
const TYPE = { text: 'Text', faq: 'FAQs', product: 'Product', file: 'File', url: 'Web page', catalog: 'Catalogue' };

export default function Knowledge() {
  const orgId = useOrgId();
  const can = useCan();
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<'text' | 'faq' | 'file' | 'url' | null>(null);
  const [edit, setEdit] = useState<Source | null>(null);
  const list = useQuery({
    queryKey: ['knowledge', orgId, page],
    queryFn: () => api.list<Source>(`/orgs/${orgId}/knowledge?page=${page}`),
    refetchInterval: (q) => (q.state.data?.data.some((s) => s.status === 'pending' || s.status === 'processing') ? 2000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge', orgId] });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/orgs/${orgId}/knowledge/${id}`), onSuccess: () => (refresh(), toast('Removed from knowledge base')), onError: (e) => toast(errorMessage(e), 'brick') });
  const reindex = useMutation({ mutationFn: (id: string) => api.post(`/orgs/${orgId}/knowledge/${id}/reindex`), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'brick') });
  const write = can('knowledge:write');

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Knowledge base"
        description="Approved information the agent searches before answering. Documents are treated as reference material: instructions inside them are ignored."
        actions={write && (
          <>
            <Button variant="secondary" onClick={() => setAdding('file')}><Upload className="size-4" /> Upload file</Button>
            <Button variant="secondary" onClick={() => setAdding('url')}><Globe className="size-4" /> Import web page</Button>
            <Button variant="secondary" onClick={() => setAdding('faq')}><Plus className="size-4" /> FAQs</Button>
            <Button onClick={() => setAdding('text')}><Plus className="size-4" /> Write text</Button>
          </>
        )}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {list.isLoading && <Spinner />}
          {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
          {list.data?.data.length === 0 && (
            <EmptyState icon={<BookOpen className="size-6" />} title="Nothing here yet">
              Add policies, shipping and returns information, FAQs or brochures. Products you add appear here automatically.
            </EmptyState>
          )}
          <ul className="flex flex-col gap-2">
            {list.data?.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <button className="truncate text-left text-sm font-medium hover:text-brand disabled:hover:text-ink" disabled={!['text', 'faq'].includes(s.type) || !write} onClick={() => setEdit(s)}>{s.title}</button>
                  <p className="text-xs text-muted">{TYPE[s.type]} · {bytes(s.bytes)} · {s.chunkCount} sections · updated {relTime(s.updatedAt)}</p>
                  {s.status === 'failed' && s.error && <p className="mt-1 text-xs text-brick">{s.error}</p>}
                </div>
                <Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge>
                {write && s.type !== 'product' && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" aria-label={`Re-index ${s.title}`} onClick={() => reindex.mutate(s.id)}><RefreshCw className="size-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label={`Delete ${s.title}`} onClick={() => del.mutate(s.id)}><Trash2 className="size-4" /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onPage={setPage} />}
        </div>
        <SearchTester orgId={orgId} />
      </div>
      <AddDialog kind={adding} onClose={() => setAdding(null)} orgId={orgId} website={org.data?.website} onDone={refresh} />
      {edit && <EditDialog source={edit} orgId={orgId} onClose={() => setEdit(null)} onDone={refresh} />}
    </div>
  );
}

function SearchTester({ orgId }: { orgId: string }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const res = useQuery({ queryKey: ['kn-search', orgId, term], queryFn: () => api.get<{ chunkId: string; title: string; text: string; score: number }[]>(`/orgs/${orgId}/knowledge/search?q=${encodeURIComponent(term)}`), enabled: !!term });
  return (
    <Panel title="Test a question" description="See what the agent would find.">
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), setTerm(q.trim()))}>
        <Input aria-label="Question" placeholder="e.g. Do you ship abroad?" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary" aria-label="Search"><Search className="size-4" /></Button>
      </form>
      <div className="mt-3 flex flex-col gap-2">
        {res.isFetching && <Spinner label="Searching" />}
        {res.data?.length === 0 && <p className="text-sm text-muted">Nothing found. The agent would say it doesn't know and offer to have the team confirm.</p>}
        {res.data?.map((r) => (
          <div key={r.chunkId} className="rounded-lg bg-sunken p-3 text-sm">
            <p className="font-medium">{r.title}</p>
            <p className="mt-1 line-clamp-4 text-muted">{r.text}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddDialog({ kind, onClose, orgId, website, onDone }: { kind: 'text' | 'faq' | 'file' | 'url' | null; onClose: () => void; orgId: string; website?: string; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [faqs, setFaqs] = useState([{ question: '', answer: '' }]);
  const fileRef = useRef<HTMLInputElement>(null);
  const reset = () => (setTitle(''), setContent(''), setUrl(''), setFaqs([{ question: '', answer: '' }]));
  const save = useMutation({
    mutationFn: async () => {
      if (kind === 'text') return api.post(`/orgs/${orgId}/knowledge/text`, { title, type: 'text', content });
      if (kind === 'faq') return api.post(`/orgs/${orgId}/knowledge/text`, { title: title || 'FAQs', type: 'faq', faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()) });
      if (kind === 'url') return api.post(`/orgs/${orgId}/knowledge/url`, { url, title: title || undefined });
      const f = fileRef.current?.files?.[0];
      if (!f) throw new Error('Choose a file to upload.');
      const fd = new FormData();
      fd.append('file', f);
      if (title) fd.append('title', title);
      return api.upload(`/orgs/${orgId}/knowledge/upload`, fd);
    },
    onSuccess: () => (onDone(), reset(), onClose(), toast('Added. Indexing starts now.')),
  });
  if (!kind) return null;
  const titles = { text: 'Write text', faq: 'Add FAQs', file: 'Upload a file', url: 'Import a web page' };
  return (
    <Dialog wide={kind !== 'url'} open onClose={onClose} title={titles[kind]} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Add to knowledge base</Button></>}>
      <div className="flex flex-col gap-4">
        {save.isError && <ErrorState error={new Error(errorMessage(save.error))} />}
        <Field label={kind === 'text' ? 'Title' : 'Title (optional)'}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {kind === 'text' && <Field label="Content"><Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} /></Field>}
        {kind === 'faq' && (
          <div className="flex flex-col gap-3">
            {faqs.map((f, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <Field label={`Question ${i + 1}`}><Input value={f.question} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} /></Field>
                <Field label="Answer"><Textarea rows={1} value={f.answer} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} /></Field>
              </div>
            ))}
            <div><Button variant="secondary" size="sm" onClick={() => setFaqs([...faqs, { question: '', answer: '' }])}><Plus className="size-4" /> Another question</Button></div>
          </div>
        )}
        {kind === 'file' && (
          <Field label="File" hint="PDF, TXT, Markdown or CSV, up to 5 MB. Only the extracted text is kept; scanned PDFs need OCR first.">
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv" className="text-sm" />
          </Field>
        )}
        {kind === 'url' && (
          <>
            {!website && <Notice tone="ochre">Add your website in Settings first. Only pages on your own domain can be imported.</Notice>}
            <Field label="Page address" hint={website ? `Must be on ${new URL(website).hostname}.` : undefined}><Input type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function EditDialog({ source, orgId, onClose, onDone }: { source: Source; orgId: string; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['knowledge-item', orgId, source.id], queryFn: () => api.get<Source & { content: string | { question: string; answer: string }[] }>(`/orgs/${orgId}/knowledge/${source.id}`) });
  const [title, setTitle] = useState(source.title);
  const [text, setText] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[] | null>(null);
  const [tab, setTab] = useState<'edit'>('edit');
  const data = q.data;
  const content = text ?? (typeof data?.content === 'string' ? data.content : '');
  const items = faqs ?? (Array.isArray(data?.content) ? data!.content : []);
  const save = useMutation({ mutationFn: () => api.put(`/orgs/${orgId}/knowledge/${source.id}`, source.type === 'faq' ? { title, type: 'faq', faqs: items } : { title, type: 'text', content }), onSuccess: () => (onDone(), onClose()) });
  return (
    <Dialog wide open onClose={onClose} title={`Edit ${source.title}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save and re-index</Button></>}>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'edit', label: 'Content' }]} />
      {q.isLoading ? <Spinner /> : (
        <div className="mt-4 flex flex-col gap-4">
          {save.isError && <ErrorState error={new Error(errorMessage(save.error))} />}
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          {source.type === 'text' ? (
            <Field label="Content"><Textarea rows={12} value={content} onChange={(e) => setText(e.target.value)} /></Field>
          ) : (
            items.map((f, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Question"><Input value={f.question} onChange={(e) => setFaqs(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} /></Field>
                <Field label="Answer"><Input value={f.answer} onChange={(e) => setFaqs(items.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} /></Field>
                <div className="flex items-end"><Button variant="ghost" aria-label="Remove" onClick={() => setFaqs(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></div>
              </div>
            ))
          )}
        </div>
      )}
    </Dialog>
  );
}
