import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { knowledgeTextSchema, knowledgeUrlSchema, paginationSchema } from '@closewell/shared';
import { env } from '../../config/env';
import { AppError, notFound } from '../../lib/errors';
import { body, escapeRegex, ok, paged, parse, query } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { Organization } from '../../models/identity';
import { KnowledgeSource } from '../../models/knowledge';
import { audit, userActor } from '../../services/audit';
import { assertCanAdd, planFor } from '../../services/entitlements';
import { assertUrlAuthorized, extractUpload } from './extract';
import { createSource, deleteSource, reindexSource, retrieve, updateSourceContent } from './service';

export const knowledgeRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.KNOWLEDGE_MAX_FILE_MB * 1024 * 1024, files: 1 } });

const serialize = (s: Record<string, any>) => ({
  id: String(s._id),
  type: s.type,
  title: s.title,
  status: s.status,
  error: s.error,
  bytes: s.bytes,
  chunkCount: s.chunkCount,
  file: s.file?.name ? s.file : undefined,
  url: s.url,
  productId: s.productId ? String(s.productId) : null,
  version: s.version,
  indexedAt: s.indexedAt,
  updatedAt: s.updatedAt,
  createdAt: s.createdAt,
});

async function assertBytesAvailable(orgId: mongoose.Types.ObjectId, adding: number) {
  const { plan } = await planFor(orgId);
  const [agg] = await KnowledgeSource.aggregate<{ total: number }>([{ $match: { orgId } }, { $group: { _id: null, total: { $sum: '$bytes' } } }]);
  if ((agg?.total ?? 0) + adding > plan.limits.knowledge_bytes) {
    throw new AppError('limit_exceeded', `Your ${plan.name} plan stores up to ${Math.round(plan.limits.knowledge_bytes / 1024 / 1024)} MB of knowledge text. Remove sources or upgrade.`);
  }
}

knowledgeRouter.get('/', requirePermission('knowledge:read'), async (req, res) => {
  const c = ctx(req);
  const { page, pageSize } = query(req, paginationSchema);
  const q = query(req, z.object({ type: z.string().max(20).optional(), status: z.string().max(20).optional(), q: z.string().max(100).optional() }));
  const filter: Record<string, unknown> = { orgId: c.orgId };
  if (q.type) filter.type = q.type;
  if (q.status) filter.status = q.status;
  if (q.q) filter.title = { $regex: escapeRegex(q.q), $options: 'i' };
  const [items, total] = await Promise.all([
    KnowledgeSource.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    KnowledgeSource.countDocuments(filter),
  ]);
  res.json(paged(items.map(serialize), page, pageSize, total));
});

/** Test retrieval exactly as the agent would see it. */
knowledgeRouter.get('/search', requirePermission('knowledge:read'), async (req, res) => {
  const { q } = query(req, z.object({ q: z.string().min(1).max(300) }));
  res.json(ok(await retrieve(ctx(req).orgId, q, 8)));
});

knowledgeRouter.get('/:id', requirePermission('knowledge:read'), async (req, res) => {
  const s = await KnowledgeSource.findOne({ _id: parse(idParam, req.params.id), orgId: ctx(req).orgId }).select('+content').lean();
  if (!s) throw notFound('Knowledge source');
  const content = s.type === 'faq' ? safeJson(s.content) : (s.content ?? '').slice(0, 100_000);
  res.json(ok({ ...serialize(s), content }));
});

function safeJson(s: string | undefined) {
  try {
    return JSON.parse(s ?? '[]');
  } catch {
    return [];
  }
}

knowledgeRouter.post('/text', requirePermission('knowledge:write'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, knowledgeTextSchema);
  const content = input.type === 'faq' ? JSON.stringify(input.faqs ?? []) : (input.content ?? '');
  if (input.type === 'faq' ? !(input.faqs ?? []).length : !content.trim()) throw new AppError('validation_failed', 'Add some content first', { fields: { content: 'Required' } });
  await assertCanAdd(c.orgId, 'knowledge_sources');
  await assertBytesAvailable(c.orgId, Buffer.byteLength(content));
  const s = await createSource(c.orgId, { type: input.type, title: input.title, content, createdBy: c.userId });
  await audit(c.orgId, userActor(c.userId), 'knowledge.created', { type: 'knowledge', id: s._id }, { type: input.type });
  res.status(201).json(ok(serialize(s.toObject())));
});

knowledgeRouter.post('/upload', requirePermission('knowledge:write'), upload.single('file'), async (req, res) => {
  const c = ctx(req);
  if (!req.file) throw new AppError('bad_request', 'Attach a file to upload.');
  const text = await extractUpload(req.file);
  await assertCanAdd(c.orgId, 'knowledge_sources');
  await assertBytesAvailable(c.orgId, Buffer.byteLength(text));
  const title = parse(z.string().trim().max(200).optional(), req.body?.title) || req.file.originalname;
  // The original file is not stored: only extracted text is kept (data minimisation).
  const s = await createSource(c.orgId, { type: 'file', title, content: text, file: { name: req.file.originalname.slice(0, 200), mime: req.file.mimetype, size: req.file.size }, createdBy: c.userId });
  await audit(c.orgId, userActor(c.userId), 'knowledge.uploaded', { type: 'knowledge', id: s._id }, { mime: req.file.mimetype, size: req.file.size });
  res.status(201).json(ok(serialize(s.toObject())));
});

knowledgeRouter.post('/url', requirePermission('knowledge:write'), async (req, res) => {
  const c = ctx(req);
  if (!env.URL_INGEST_ENABLED) throw new AppError('forbidden', 'Website import is disabled on this server.');
  const input = body(req, knowledgeUrlSchema);
  const org = await Organization.findById(c.orgId, { website: 1 }).lean();
  const u = assertUrlAuthorized(input.url, org?.website);
  await assertCanAdd(c.orgId, 'knowledge_sources');
  const s = await createSource(c.orgId, { type: 'url', title: input.title || u.hostname + u.pathname, url: u.toString(), createdBy: c.userId });
  await audit(c.orgId, userActor(c.userId), 'knowledge.url_added', { type: 'knowledge', id: s._id }, { host: u.hostname });
  res.status(201).json(ok(serialize(s.toObject())));
});

knowledgeRouter.put('/:id', requirePermission('knowledge:write'), async (req, res) => {
  const c = ctx(req);
  const id = new mongoose.Types.ObjectId(parse(idParam, req.params.id));
  const existing = await KnowledgeSource.findOne({ _id: id, orgId: c.orgId }).lean();
  if (!existing) throw notFound('Knowledge source');
  if (!['text', 'faq'].includes(existing.type)) throw new AppError('bad_request', 'Only text and FAQ sources can be edited here. Edit products on the Products page; re-upload files.');
  const input = body(req, knowledgeTextSchema);
  const content = existing.type === 'faq' ? JSON.stringify(input.faqs ?? []) : (input.content ?? '');
  const s = await updateSourceContent(c.orgId, id, input.title, content);
  await audit(c.orgId, userActor(c.userId), 'knowledge.updated', { type: 'knowledge', id });
  res.json(ok(serialize(s!.toObject())));
});

knowledgeRouter.post('/:id/reindex', requirePermission('knowledge:write'), async (req, res) => {
  const c = ctx(req);
  const id = new mongoose.Types.ObjectId(parse(idParam, req.params.id));
  const existing = await KnowledgeSource.findOne({ _id: id, orgId: c.orgId }).select('+content');
  if (!existing) throw notFound('Knowledge source');
  // URLs are re-fetched on re-index so changes on the website are picked up.
  if (existing.type === 'url') await KnowledgeSource.updateOne({ _id: id, orgId: c.orgId }, { $set: { content: '' } });
  const s = await reindexSource(c.orgId, id);
  res.json(ok(serialize(s!.toObject())));
});

knowledgeRouter.delete('/:id', requirePermission('knowledge:write'), async (req, res) => {
  const c = ctx(req);
  const id = new mongoose.Types.ObjectId(parse(idParam, req.params.id));
  const existing = await KnowledgeSource.findOne({ _id: id, orgId: c.orgId }).lean();
  if (!existing) throw notFound('Knowledge source');
  if (existing.type === 'product') throw new AppError('bad_request', 'This entry is generated from a product. Edit or delete the product instead.');
  await deleteSource(c.orgId, id);
  await audit(c.orgId, userActor(c.userId), 'knowledge.deleted', { type: 'knowledge', id });
  res.json(ok({ deleted: true }));
});
