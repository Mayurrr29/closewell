import mongoose, { Schema } from 'mongoose';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

const sourceSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ['text', 'faq', 'product', 'file', 'url', 'catalog'], required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['pending', 'processing', 'ready', 'failed'], default: 'pending' },
    error: { type: String, default: null },
    /** Raw text for text/faq sources; extracted text for files/urls (kept so re-indexing needs no re-upload). */
    content: { type: String, default: '', select: false },
    contentHash: String,
    bytes: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    file: { name: String, mime: String, size: Number },
    url: String,
    productId: { type: Schema.Types.ObjectId, default: null },
    version: { type: Number, default: 1 },
    indexedAt: Date,
    createdBy: Schema.Types.ObjectId,
  },
  { timestamps: true },
);
sourceSchema.index({ orgId: 1, createdAt: -1 });
sourceSchema.plugin(tenantPlugin);
export const KnowledgeSource = model('KnowledgeSource', sourceSchema);

/**
 * Searchable chunk. `terms` holds normalised, stemmed tokens so retrieval
 * works on any MongoDB-compatible server without text or vector indexes.
 */
const chunkSchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, required: true },
  sourceId: { type: Schema.Types.ObjectId, required: true },
  sourceVersion: Number,
  ordinal: Number,
  title: String,
  text: String,
  terms: { type: [String], default: [] },
  termCount: Number,
});
chunkSchema.index({ orgId: 1, terms: 1 });
chunkSchema.index({ orgId: 1, sourceId: 1 });
chunkSchema.plugin(tenantPlugin);
export const KnowledgeChunk = model('KnowledgeChunk', chunkSchema);
