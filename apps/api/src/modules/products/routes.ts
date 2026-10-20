import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { paginationSchema, productSchema } from '@closewell/shared';
import { parseCsv } from '../../lib/csv';
import { AppError, notFound } from '../../lib/errors';
import { body, escapeRegex, ok, paged, parse, query } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { Product } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { assertCanAdd } from '../../services/entitlements';
import { deleteSource, syncProductKnowledge } from '../knowledge/service';

export const productsRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const serialize = (p: Record<string, any>) => ({
  id: String(p._id),
  name: p.name,
  kind: p.kind,
  description: p.description,
  sku: p.sku,
  pricingModel: p.pricingModel,
  price: p.price,
  currency: p.currency,
  priceUnit: p.priceUnit,
  availability: p.availability,
  tags: p.tags,
  faqs: p.faqs,
  active: p.active,
  updatedAt: p.updatedAt,
});

productsRouter.get('/', requirePermission('products:read'), async (req, res) => {
  const { page, pageSize } = query(req, paginationSchema);
  const q = query(req, z.object({ q: z.string().max(100).optional(), kind: z.enum(['product', 'service']).optional(), active: z.enum(['true', 'false']).optional() }));
  const filter: Record<string, unknown> = { orgId: ctx(req).orgId };
  if (q.q) filter.name = { $regex: escapeRegex(q.q), $options: 'i' };
  if (q.kind) filter.kind = q.kind;
  if (q.active) filter.active = q.active === 'true';
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Product.countDocuments(filter),
  ]);
  res.json(paged(items.map(serialize), page, pageSize, total));
});

productsRouter.post('/', requirePermission('products:write'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, productSchema);
  await assertCanAdd(c.orgId, 'products');
  const p = await Product.create({ ...input, orgId: c.orgId });
  await syncProductKnowledge(c.orgId, p._id);
  await audit(c.orgId, userActor(c.userId), 'product.created', { type: 'product', id: p._id });
  res.status(201).json(ok(serialize(p.toObject())));
});

productsRouter.get('/:id', requirePermission('products:read'), async (req, res) => {
  const p = await Product.findOne({ _id: parse(idParam, req.params.id), orgId: ctx(req).orgId }).lean();
  if (!p) throw notFound('Product');
  res.json(ok(serialize(p)));
});

productsRouter.patch('/:id', requirePermission('products:write'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const existing = await Product.findOne({ _id: id, orgId: c.orgId }).lean();
  if (!existing) throw notFound('Product');
  // Re-validate the merged document so cross-field rules (price vs quote_only) still hold.
  const merged = parse(productSchema, { ...serialize(existing), ...req.body });
  const p = await Product.findOneAndUpdate({ _id: id, orgId: c.orgId }, { $set: merged }, { new: true }).lean();
  await syncProductKnowledge(c.orgId, id as unknown as import('mongoose').Types.ObjectId);
  await audit(c.orgId, userActor(c.userId), 'product.updated', { type: 'product', id }, { priceChanged: existing.price !== merged.price });
  res.json(ok(serialize(p!)));
});

productsRouter.delete('/:id', requirePermission('products:write'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const p = await Product.findOneAndDelete({ _id: id, orgId: c.orgId });
  if (!p) throw notFound('Product');
  if (p.knowledgeSourceId) await deleteSource(c.orgId, p.knowledgeSourceId);
  await audit(c.orgId, userActor(c.userId), 'product.deleted', { type: 'product', id });
  res.json(ok({ deleted: true }));
});

/** Structured catalogue import (CSV). Columns: name, kind, description, price, currency, price_unit, pricing_model, availability, sku, tags */
productsRouter.post('/import', requirePermission('products:write'), csvUpload.single('file'), async (req, res) => {
  const c = ctx(req);
  if (!req.file) throw new AppError('bad_request', 'Attach a CSV file.');
  if (!/\.csv$/i.test(req.file.originalname)) throw new AppError('unsupported_media_type', 'Upload a .csv file.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer).replace(/^﻿/, '');
  } catch {
    throw new AppError('unsupported_media_type', 'The CSV must be UTF-8 encoded.');
  }
  const rows = parseCsv(text);
  if (!rows.length) throw new AppError('bad_request', 'The CSV has no data rows.');
  if (rows.length > 1000) throw new AppError('payload_too_large', 'Import up to 1,000 rows at a time.');
  await assertCanAdd(c.orgId, 'products', rows.length);
  const errors: { row: number; message: string }[] = [];
  let created = 0;
  for (const [i, r] of rows.entries()) {
    const priceRaw = r.price?.replace(/[^0-9.]/g, '');
    const candidate = {
      name: r.name,
      kind: r.kind === 'service' ? 'service' : 'product',
      description: r.description ?? '',
      sku: r.sku || undefined,
      pricingModel: (['fixed', 'starting_at', 'quote_only'].includes(r.pricing_model) ? r.pricing_model : priceRaw ? 'fixed' : 'quote_only') as 'fixed',
      price: priceRaw ? Number(priceRaw) : null,
      currency: r.currency || undefined,
      priceUnit: r.price_unit || undefined,
      availability: (['available', 'limited', 'unavailable', 'unknown'].includes(r.availability) ? r.availability : 'available') as 'available',
      tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
    };
    const v = productSchema.safeParse(candidate);
    if (!v.success) {
      errors.push({ row: i + 2, message: v.error.issues[0]?.message ?? 'Invalid row' });
      continue;
    }
    const p = await Product.create({ ...v.data, orgId: c.orgId });
    await syncProductKnowledge(c.orgId, p._id);
    created++;
  }
  await audit(c.orgId, userActor(c.userId), 'product.imported', { type: 'product' }, { created, failed: errors.length });
  res.status(created ? 201 : 422).json(ok({ created, errors }));
});
