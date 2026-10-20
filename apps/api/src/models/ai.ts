import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

/** Agent: `config` is the editable draft; `published` is the frozen snapshot used on live channels. */
const agentSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    config: { type: Schema.Types.Mixed, required: true },
    published: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['draft', 'published', 'disabled'], default: 'draft' },
    publishedAt: { type: Date, default: null },
    publishedVersion: { type: Number, default: 0 },
    lastSimulationAt: { type: Date, default: null },
  },
  { timestamps: true },
);
agentSchema.plugin(tenantPlugin);
export const Agent = model('Agent', agentSchema);
export type AgentDoc = InferSchemaType<typeof agentSchema> & { _id: Types.ObjectId };

/** One record per AI turn: what the model saw, did, cost, and which guards fired. */
const agentRunSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    agentId: Schema.Types.ObjectId,
    conversationId: Schema.Types.ObjectId,
    channel: String,
    provider: String,
    model: String,
    status: { type: String, enum: ['ok', 'guarded', 'escalated', 'error', 'timeout', 'skipped', 'limit'], required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    latencyMs: Number,
    rounds: Number,
    toolCalls: { type: [Schema.Types.Mixed], default: [] },
    flags: { type: [Schema.Types.Mixed], default: [] },
    retrievedChunkIds: { type: [Schema.Types.ObjectId], default: [] },
    error: String,
    isTest: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
agentRunSchema.index({ orgId: 1, createdAt: -1 });
agentRunSchema.plugin(tenantPlugin);
export const AgentRun = model('AgentRun', agentRunSchema);

/** An action the AI requested that needs a human decision (spec section 8). */
const pendingActionSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    conversationId: { type: Schema.Types.ObjectId, default: null },
    leadId: { type: Schema.Types.ObjectId, default: null },
    agentRunId: { type: Schema.Types.ObjectId, default: null },
    tool: { type: String, required: true },
    category: { type: String, enum: ['A', 'B', 'C'], required: true },
    args: { type: Schema.Types.Mixed, default: {} },
    summary: { type: String, required: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: Date,
    decisionNote: String,
    expiresAt: { type: Date, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    result: Schema.Types.Mixed,
    error: String,
    executedAt: Date,
  },
  { timestamps: true },
);
pendingActionSchema.index({ orgId: 1, status: 1, createdAt: -1 });
pendingActionSchema.plugin(tenantPlugin);
export const PendingAction = model('PendingAction', pendingActionSchema);
