import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

const conversationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    agentId: { type: Schema.Types.ObjectId, default: null },
    channel: { type: String, enum: ['web', 'whatsapp', 'voice', 'playground'], required: true },
    leadId: { type: Schema.Types.ObjectId, default: null },
    contact: { name: { type: String, default: '' }, email: { type: String, default: '' }, phone: { type: String, default: '' } },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    /**
     * ai: the agent may reply. paused: nobody automated replies. human: a team
     * member has taken over. The agent replies ONLY when aiMode === 'ai'.
     */
    aiMode: { type: String, enum: ['ai', 'paused', 'human'], default: 'ai' },
    assignedTo: { type: Schema.Types.ObjectId, default: null },
    escalated: { type: Boolean, default: false },
    escalationReason: { type: String, default: '' },
    tags: { type: [String], default: [] },
    summary: { type: String, default: '' },
    suggestedNextAction: { type: String, default: '' },
    aiTurns: { type: Number, default: 0 },
    /** Short lease so only one AI turn runs per conversation at a time. */
    aiLockUntil: { type: Date, default: null },
    lastActivityAt: { type: Date, default: () => new Date() },
    lastCustomerMessageAt: Date,
    lastMessagePreview: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true },
);
conversationSchema.index({ orgId: 1, lastActivityAt: -1 });
conversationSchema.index({ orgId: 1, status: 1 });
conversationSchema.plugin(tenantPlugin);
export const Conversation = model('Conversation', conversationSchema);
export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };

/** Structured timeline entry: customer/AI/human messages, internal notes and system events. */
const messageSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['message', 'note', 'event'], default: 'message' },
    role: { type: String, enum: ['customer', 'ai', 'human', 'system'], required: true },
    authorId: { type: Schema.Types.ObjectId, default: null },
    content: { type: String, default: '' },
    event: { type: { type: String }, data: Schema.Types.Mixed },
    meta: { type: Schema.Types.Mixed, default: {} },
    seq: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ orgId: 1, conversationId: 1, createdAt: 1 });
messageSchema.plugin(tenantPlugin);
export const Message = model('Message', messageSchema);

const widgetSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true, unique: true },
    publicKey: { type: String, required: true, unique: true },
    agentId: { type: Schema.Types.ObjectId, default: null },
    enabled: { type: Boolean, default: false },
    brandName: { type: String, default: '' },
    greeting: { type: String, default: 'Hi! How can I help you today?' },
    primaryColor: { type: String, default: '#2f5bea' },
    position: { type: String, enum: ['right', 'left'], default: 'right' },
    allowedDomains: { type: [String], default: [] },
    collectContact: { type: String, enum: ['off', 'optional', 'before_chat'], default: 'optional' },
    businessHours: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'UTC' },
      days: { type: [Number], default: [1, 2, 3, 4, 5] },
      start: { type: String, default: '09:00' },
      end: { type: String, default: '17:00' },
      offlineMessage: { type: String, default: '' },
    },
  },
  { timestamps: true },
);
widgetSchema.plugin(tenantPlugin);
export const WidgetConfig = model('WidgetConfig', widgetSchema);

/** Anonymous visitor session for the public widget. Token stored hashed. */
const widgetSessionSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true, unique: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    origin: String,
    preview: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    lastSeenAt: Date,
    messageCount: { type: Number, default: 0 },
    blockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
widgetSessionSchema.plugin(tenantPlugin);
export const WidgetSession = model('WidgetSession', widgetSessionSchema);
