import mongoose, { type Types } from 'mongoose';
import { sha256 } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { enqueue, registerJob } from '../../jobs/queue';
import { KnowledgeChunk, KnowledgeSource } from '../../models/knowledge';
import { Organization } from '../../models/identity';
import { Product, type ProductDoc } from '../../models/sales';
import { chunkText, faqChunks, terms, uniqueTerms } from './text';
import { fetchAuthorizedUrl } from './extract';

/** Queue (re-)indexing. The idempotency key includes the version, so duplicates collapse. */
export async function scheduleIndex(orgId: Types.ObjectId, sourceId: Types.ObjectId, version: number) {
  await enqueue('knowledge.index', { sourceId: String(sourceId) }, { orgId, idempotencyKey: `kn:${sourceId}:v${version}`, maxAttempts: 3 });
}

function chunksFor(source: { type: string; content: string }): string[] {
  if (source.type === 'faq') {
    try {
      const faqs = JSON.parse(source.content) as { question: string; answer: string }[];
      return faqChunks(faqs);
    } catch {
      return chunkText(source.content);
    }
  }
  return chunkText(source.content);
}

/** Job: extract (for URLs), chunk and index a source. Replaces older chunks atomically per version. */
registerJob('knowledge.index', async (payload, job) => {
  const orgId = job.orgId!;
  const source = await KnowledgeSource.findOne({ _id: payload.sourceId, orgId }).select('+content');
  if (!source) return;
  await KnowledgeSource.updateOne({ _id: source._id, orgId }, { $set: { status: 'processing', error: null } });
  try {
    if (source.type === 'url' && source.url && !source.content) {
      const org = await Organization.findById(orgId, { website: 1 }).lean();
      const { text } = await fetchAuthorizedUrl(source.url, org?.website);
      source.content = text;
      await KnowledgeSource.updateOne({ _id: source._id, orgId }, { $set: { content: text, bytes: Buffer.byteLength(text), contentHash: sha256(text) } });
    }
    const pieces = chunksFor({ type: source.type, content: source.content ?? '' });
    const version = source.version;
    await KnowledgeChunk.insertMany(
      pieces.map((text, ordinal) => {
        const t = uniqueTerms(`${source.title}\n${text}`);
        return { orgId, sourceId: source._id, sourceVersion: version, ordinal, title: source.title, text, terms: t, termCount: terms(text).length };
      }),
    );
    await KnowledgeChunk.deleteMany({ orgId, sourceId: source._id, sourceVersion: { $ne: version } });
    await KnowledgeSource.updateOne({ _id: source._id, orgId, version }, { $set: { status: 'ready', chunkCount: pieces.length, indexedAt: new Date(), error: null } });
  } catch (err) {
    const message = (err as Error).message ?? 'Processing failed';
    logger.warn({ sourceId: String(source._id), err: message }, 'Knowledge indexing failed');
    await KnowledgeSource.updateOne({ _id: source._id, orgId }, { $set: { status: 'failed', error: message.slice(0, 300) } });
    if (job.attempts < 3 && !/allow|private|import pages|HTTP 4/.test(message)) throw err; // retry transient errors only
  }
});

export async function createSource(
  orgId: Types.ObjectId,
  data: { type: 'text' | 'faq' | 'file' | 'url' | 'product' | 'catalog'; title: string; content?: string; url?: string; file?: { name: string; mime: string; size: number }; productId?: Types.ObjectId; createdBy?: Types.ObjectId },
) {
  const content = data.content ?? '';
  const src = await KnowledgeSource.create({ orgId, ...data, content, contentHash: content ? sha256(content) : undefined, bytes: Buffer.byteLength(content), status: 'pending' });
  await scheduleIndex(orgId, src._id, src.version);
  return src;
}

/** Replace content and re-index only if it actually changed. */
export async function updateSourceContent(orgId: Types.ObjectId, sourceId: Types.ObjectId, title: string, content: string) {
  const src = await KnowledgeSource.findOne({ _id: sourceId, orgId }).select('+content');
  if (!src) return null;
  const hash = sha256(content);
  if (hash === src.contentHash && title === src.title) return src;
  // update + read (not findOneAndUpdate): some MongoDB-compatible servers reject projections in findAndModify.
  await KnowledgeSource.updateOne({ _id: sourceId, orgId }, { $set: { title, content, contentHash: hash, bytes: Buffer.byteLength(content), status: 'pending' }, $inc: { version: 1 } });
  const updated = await KnowledgeSource.findOne({ _id: sourceId, orgId });
  await scheduleIndex(orgId, sourceId, updated!.version);
  return updated;
}

export async function reindexSource(orgId: Types.ObjectId, sourceId: Types.ObjectId) {
  const r = await KnowledgeSource.updateOne({ _id: sourceId, orgId }, { $set: { status: 'pending' }, $inc: { version: 1 } });
  const updated = r.matchedCount ? await KnowledgeSource.findOne({ _id: sourceId, orgId }) : null;
  if (updated) await scheduleIndex(orgId, sourceId, updated.version);
  return updated;
}

export async function deleteSource(orgId: Types.ObjectId, sourceId: Types.ObjectId) {
  await KnowledgeChunk.deleteMany({ orgId, sourceId });
  return KnowledgeSource.deleteOne({ orgId, _id: sourceId });
}

// ---------- Products as knowledge ----------

export function renderProduct(p: Pick<ProductDoc, 'name' | 'kind' | 'description' | 'pricingModel' | 'price' | 'currency' | 'priceUnit' | 'availability' | 'faqs' | 'sku'>, orgCurrency: string): string {
  const cur = p.currency || orgCurrency;
  const price =
    p.pricingModel === 'quote_only' || p.price === null
      ? 'Price: quote on request (no list price).'
      : `Price: ${p.pricingModel === 'starting_at' ? 'from ' : ''}${p.price} ${cur}${p.priceUnit ? ` ${p.priceUnit}` : ''}.`;
  const lines = [`${p.kind === 'service' ? 'Service' : 'Product'}: ${p.name}${p.sku ? ` (SKU ${p.sku})` : ''}`, price, `Availability: ${p.availability}.`, p.description];
  for (const f of p.faqs ?? []) lines.push(`Q: ${f.question}\nA: ${f.answer}`);
  return lines.filter(Boolean).join('\n\n');
}

export async function syncProductKnowledge(orgId: Types.ObjectId, productId: Types.ObjectId) {
  const p = await Product.findOne({ _id: productId, orgId });
  if (!p) return;
  const org = await Organization.findById(orgId, { currency: 1 }).lean();
  if (!p.active) {
    if (p.knowledgeSourceId) await deleteSource(orgId, p.knowledgeSourceId);
    await Product.updateOne({ _id: p._id, orgId }, { $set: { knowledgeSourceId: null } });
    return;
  }
  const content = renderProduct(p, org?.currency ?? 'USD');
  if (p.knowledgeSourceId && (await KnowledgeSource.exists({ _id: p.knowledgeSourceId, orgId }))) {
    await updateSourceContent(orgId, p.knowledgeSourceId, p.name, content);
  } else {
    const src = await createSource(orgId, { type: 'product', title: p.name, content, productId: p._id });
    await Product.updateOne({ _id: p._id, orgId }, { $set: { knowledgeSourceId: src._id } });
  }
}

// ---------- Retrieval ----------

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  title: string;
  text: string;
  score: number;
}

/**
 * BM25-style keyword retrieval scoped to ONE organization. orgId is
 * mandatory and comes from the server-side context, never from the model
 * or the customer.
 */
export async function retrieve(orgId: Types.ObjectId, queryText: string, k = 5): Promise<RetrievedChunk[]> {
  if (!(orgId instanceof mongoose.Types.ObjectId)) throw new Error('retrieve() requires an ObjectId orgId');
  const q = [...new Set(terms(queryText))].slice(0, 30);
  if (!q.length) return [];
  const candidates = await KnowledgeChunk.find({ orgId, terms: { $in: q } }, { text: 1, title: 1, terms: 1, termCount: 1, sourceId: 1 }).limit(400).lean();
  if (!candidates.length) return [];
  const N = candidates.length;
  const avgLen = candidates.reduce((s, c) => s + (c.termCount ?? 50), 0) / N;
  const df = new Map<string, number>();
  for (const term of q) df.set(term, candidates.filter((c) => c.terms.includes(term)).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = candidates.map((c) => {
    const tf = new Map<string, number>();
    for (const t of terms(`${c.title}\n${c.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * (c.termCount ?? avgLen)) / avgLen)));
    }
    return { chunkId: String(c._id), sourceId: String(c.sourceId), title: c.title ?? '', text: c.text ?? '', score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
