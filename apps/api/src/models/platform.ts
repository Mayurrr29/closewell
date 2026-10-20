import mongoose, { Schema } from 'mongoose';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

const auditSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    actor: {
      type: { type: String, enum: ['user', 'ai', 'system', 'customer'], required: true },
      id: String,
      label: String,
    },
    action: { type: String, required: true },
    target: { type: { type: String }, id: String },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ orgId: 1, createdAt: -1 });
auditSchema.plugin(tenantPlugin);
export const AuditLog = mongoose.model('AuditLog', auditSchema);

/**
 * Durable job queue stored in MongoDB. Jobs survive restarts; a worker
 * claims one atomically (findOneAndUpdate) and holds a lease (lockedUntil).
 * If the worker dies, the lease expires and another worker retries it.
 */
const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    orgId: { type: Schema.Types.ObjectId, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed', 'dead'], default: 'queued' },
    runAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedUntil: { type: Date, default: null },
    lastError: String,
    idempotencyKey: { type: String, required: true, unique: true },
    finishedAt: Date,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
export const Job = model('Job', jobSchema);

/** Monthly usage counters per organization, incremented atomically. */
const usageSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true }, // YYYY-MM (UTC)
    metric: { type: String, required: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usageSchema.index({ orgId: 1, period: 1, metric: 1 }, { unique: true });
usageSchema.plugin(tenantPlugin);
export const UsageCounter = model('UsageCounter', usageSchema);

/** De-duplication ledger for inbound events (webhooks, client message ids). */
const processedEventSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    orgId: { type: Schema.Types.ObjectId },
    result: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const ProcessedEvent = model('ProcessedEvent', processedEventSchema);
