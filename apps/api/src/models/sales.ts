import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

const faq = new Schema({ question: String, answer: String }, { _id: false });

const productSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ['product', 'service'], default: 'product' },
    description: { type: String, default: '' },
    sku: String,
    pricingModel: { type: String, enum: ['fixed', 'starting_at', 'quote_only'], default: 'fixed' },
    price: { type: Number, default: null },
    currency: String,
    priceUnit: String,
    availability: { type: String, enum: ['available', 'limited', 'unavailable', 'unknown'], default: 'available' },
    tags: { type: [String], default: [] },
    faqs: { type: [faq], default: [] },
    active: { type: Boolean, default: true },
    knowledgeSourceId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
productSchema.index({ orgId: 1, name: 1 });
productSchema.plugin(tenantPlugin);
export const Product = model('Product', productSchema);
export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };

const pipelineSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true, unique: true },
    stages: [{ _id: false, key: String, name: String, type: { type: String, enum: ['open', 'won', 'lost'] } }],
  },
  { timestamps: true },
);
pipelineSchema.plugin(tenantPlugin);
export const Pipeline = model('Pipeline', pipelineSchema);

const leadSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true },
    phone: { type: String, default: '' },
    company: { type: String, default: '' },
    source: { type: String, default: 'manual' },
    industry: { type: String, default: '' },
    requirements: { type: String, default: '' },
    budget: { amount: { type: Number, default: null }, currency: String },
    timeline: { type: String, default: '' },
    dealValue: { type: Number, default: null },
    assignedTo: { type: Schema.Types.ObjectId, default: null },
    score: { type: Number, default: 0 },
    scoreBreakdown: { type: Schema.Types.Mixed, default: [] },
    qualificationAnswers: { type: Schema.Types.Mixed, default: {} },
    stageKey: { type: String, default: 'new' },
    stageType: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
    wonAt: { type: Date, default: null },
    lostAt: { type: Date, default: null },
    lastContactAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null },
    consent: {
      contactAllowed: { type: Boolean, default: false },
      marketingAllowed: { type: Boolean, default: false },
      preferredChannel: { type: String, default: 'none' },
      optedOutAt: { type: Date, default: null },
      recordedAt: Date,
    },
    tags: { type: [String], default: [] },
    conversationIds: { type: [Schema.Types.ObjectId], default: [] },
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true },
);
leadSchema.index({ orgId: 1, createdAt: -1 });
leadSchema.index({ orgId: 1, stageKey: 1 });
leadSchema.index({ orgId: 1, assignedTo: 1 });
leadSchema.plugin(tenantPlugin);
export const Lead = model('Lead', leadSchema);
export type LeadDoc = InferSchemaType<typeof leadSchema> & { _id: Types.ObjectId };

const leadActivitySchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    leadId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ['note', 'stage_change', 'assignment', 'ai_update', 'reminder', 'created', 'updated', 'consent'], required: true },
    actor: { type: { type: String }, id: String, label: String },
    body: { type: String, default: '' },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
leadActivitySchema.index({ orgId: 1, leadId: 1, createdAt: -1 });
leadActivitySchema.plugin(tenantPlugin);
export const LeadActivity = model('LeadActivity', leadActivitySchema);

const reminderSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    leadId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    dueAt: { type: Date, required: true },
    note: { type: String, default: '' },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true },
);
reminderSchema.index({ orgId: 1, userId: 1, dueAt: 1 });
reminderSchema.plugin(tenantPlugin);
export const Reminder = model('Reminder', reminderSchema);
