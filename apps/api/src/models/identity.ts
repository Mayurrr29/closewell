import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { ORG_ROLES, PLAN_IDS } from '@closewell/shared';
import { tenantPlugin } from '../db/tenant';

const { model } = mongoose;

// ---------- Users & sessions (platform-level, not tenant-owned) ----------

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    isPlatformAdmin: { type: Boolean, default: false },
    lastLoginAt: Date,
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    defaultOrgId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
export const User = model('User', userSchema);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

/** Refresh-token sessions. Tokens are stored as SHA-256 hashes; rotation keeps a family for reuse detection. */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: String,
    replacedAt: { type: Date, default: null },
    userAgent: String,
    ip: String,
    lastUsedAt: Date,
  },
  { timestamps: true },
);
export const Session = model('Session', sessionSchema);

const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ['verify_email', 'reset_password'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export const AuthToken = model('AuthToken', authTokenSchema);

/** Outgoing email log. In mock mode this is the only place the email exists (dev mailbox). */
const emailOutboxSchema = new Schema(
  {
    to: { type: String, required: true },
    subject: String,
    text: String,
    mode: { type: String, enum: ['mock', 'smtp'] },
    status: { type: String, enum: ['logged', 'sent', 'failed'], default: 'logged' },
    error: String,
  },
  { timestamps: true },
);
export const EmailOutbox = model('EmailOutbox', emailOutboxSchema);

// ---------- Organizations ----------

const orgSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    industry: { type: String, default: 'other' },
    website: { type: String, default: '' },
    country: { type: String, default: '' },
    currency: { type: String, default: 'USD' },
    timezone: { type: String, default: 'UTC' },
    description: { type: String, default: '' },
    onboarding: {
      completedSteps: { type: [Number], default: [] },
      completedAt: { type: Date, default: null },
    },
    subscription: {
      planId: { type: String, enum: PLAN_IDS, default: 'trial' },
      status: { type: String, enum: ['trialing', 'active', 'past_due', 'canceled', 'expired'], default: 'trialing' },
      interval: { type: String, enum: ['month', 'year'], default: 'month' },
      trialEndsAt: Date,
      currentPeriodEnd: Date,
      /** 'none' until a payment provider is configured. Never 'live' without verified webhooks. */
      provider: { type: String, default: 'none' },
    },
    retention: {
      conversationDays: { type: Number, default: 365 },
    },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
export const Organization = model('Organization', orgSchema);
export type OrgDoc = InferSchemaType<typeof orgSchema> & { _id: Types.ObjectId };

const membershipSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    role: { type: String, enum: ORG_ROLES, required: true },
  },
  { timestamps: true },
);
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
membershipSchema.plugin(tenantPlugin);
export const Membership = model('Membership', membershipSchema);

const invitationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true, index: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ORG_ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
invitationSchema.plugin(tenantPlugin);
export const Invitation = model('Invitation', invitationSchema);
