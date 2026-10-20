import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  DEFAULT_PIPELINE_STAGES,
  PLANS,
  agentConfigSchema,
  assignableRoles,
  inviteSchema,
  orgProfileSchema,
  updateMemberSchema,
  type OrgRole,
} from '@closewell/shared';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { body, ok, parse } from '../../lib/http';
import { ctx, requireAuth, requirePermission, requireVerifiedEmail } from '../../middleware/auth';
import { emailLimiter } from '../../middleware/rateLimit';
import { Agent } from '../../models/ai';
import { WidgetConfig } from '../../models/conversations';
import { Invitation, Membership, Organization, User } from '../../models/identity';
import { Pipeline } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { appUrl, sendEmail } from '../../services/email';
import { assertCanAdd } from '../../services/entitlements';
import { defaultAgentConfig } from './defaults';

export const orgsRouter = Router();

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'org'
  ) + '-' + randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function serializeOrg(o: InstanceType<typeof Organization> | Record<string, unknown>) {
  const org = o as Record<string, any>;
  return {
    id: String(org._id),
    name: org.name,
    industry: org.industry,
    website: org.website,
    country: org.country,
    currency: org.currency,
    timezone: org.timezone,
    description: org.description,
    onboarding: { completedSteps: org.onboarding?.completedSteps ?? [], completedAt: org.onboarding?.completedAt ?? null },
    subscription: org.subscription,
    retention: org.retention,
    createdAt: org.createdAt,
  };
}

/** Create an organization: the creator becomes owner; defaults are provisioned. */
orgsRouter.post('/', requireAuth, async (req, res) => {
  const input = body(req, orgProfileSchema);
  const userId = new mongoose.Types.ObjectId(req.auth!.userId);
  const owned = await Membership.countDocuments({ userId, role: 'owner' }).setOptions({ crossTenant: true });
  if (owned >= 5) throw new AppError('limit_exceeded', 'You can own up to 5 organizations.');
  const trialDays = PLANS.trial.trialDays ?? 14;
  const org = await Organization.create({
    ...input,
    website: input.website ?? '',
    slug: slugify(input.name),
    createdBy: userId,
    onboarding: { completedSteps: [1], completedAt: null },
    subscription: { planId: 'trial', status: 'trialing', interval: 'month', trialEndsAt: new Date(Date.now() + trialDays * 86400_000), provider: 'none' },
  });
  const orgId = org._id;
  await Membership.create({ orgId, userId, role: 'owner' });
  await Pipeline.create({ orgId, stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })) });
  const config = agentConfigSchema.parse(defaultAgentConfig(org));
  const agent = await Agent.create({ orgId, config });
  await WidgetConfig.create({ orgId, publicKey: `wk_${randomToken(18)}`, agentId: agent._id, brandName: org.name, enabled: false });
  await User.updateOne({ _id: userId, defaultOrgId: null }, { $set: { defaultOrgId: orgId } });
  await audit(orgId, userActor(userId), 'org.created', { type: 'organization', id: orgId });
  res.status(201).json(ok(serializeOrg(org.toObject())));
});

/** Platform administrators see organization metadata only, never tenant records. */
orgsRouter.get('/', requireAuth, async (req, res) => {
  if (!req.auth!.isPlatformAdmin) throw forbidden();
  const orgs = await Organization.find({}, { name: 1, industry: 1, subscription: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(200).lean();
  res.json(ok(orgs.map((o) => ({ id: String(o._id), name: o.name, industry: o.industry, plan: o.subscription?.planId, status: o.subscription?.status, createdAt: o.createdAt }))));
});

/** Mounted by the tenant router after requireAuth + requireOrg. */
const org = Router({ mergeParams: true });
export const orgScopedRouter = org;

org.get('/', requirePermission('org:read'), async (req, res) => {
  const o = await Organization.findById(ctx(req).orgId).lean();
  if (!o) throw notFound('Organization');
  res.json(ok({ ...serializeOrg(o), role: ctx(req).role, permissions: ctx(req).permissions }));
});

org.patch('/', requirePermission('org:update'), async (req, res) => {
  const input = body(req, orgProfileSchema.partial());
  const o = await Organization.findByIdAndUpdate(ctx(req).orgId, { $set: input }, { new: true }).lean();
  await audit(ctx(req).orgId, userActor(ctx(req).userId), 'org.updated', { type: 'organization', id: ctx(req).orgId }, { fields: Object.keys(input) });
  res.json(ok(serializeOrg(o!)));
});

org.patch('/retention', requirePermission('org:update'), async (req, res) => {
  const input = body(req, z.object({ conversationDays: z.number().int().min(30).max(3650) }));
  await Organization.updateOne({ _id: ctx(req).orgId }, { $set: { 'retention.conversationDays': input.conversationDays } });
  await audit(ctx(req).orgId, userActor(ctx(req).userId), 'org.retention_updated', { type: 'organization', id: ctx(req).orgId }, input);
  res.json(ok(input));
});

org.post('/onboarding/steps/:step', requirePermission('org:update'), async (req, res) => {
  const step = parse(z.coerce.number().int().min(1).max(8), req.params.step);
  await Organization.updateOne({ _id: ctx(req).orgId }, { $addToSet: { 'onboarding.completedSteps': step } });
  const o = await Organization.findById(ctx(req).orgId).lean();
  res.json(ok(serializeOrg(o!).onboarding));
});

// ---------- Members ----------

org.get('/members', requirePermission('members:read'), async (req, res) => {
  const ms = await Membership.find({ orgId: ctx(req).orgId }).lean();
  const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } }, { name: 1, email: 1 }).lean();
  res.json(
    ok(
      ms.map((m) => {
        const u = users.find((x) => String(x._id) === String(m.userId));
        return { userId: String(m.userId), name: u?.name ?? '', email: u?.email ?? '', role: m.role, joinedAt: m.createdAt };
      }),
    ),
  );
});

async function ownerCount(orgId: mongoose.Types.ObjectId) {
  return Membership.countDocuments({ orgId, role: 'owner' });
}

org.patch('/members/:userId', requirePermission('members:manage'), async (req, res) => {
  const c = ctx(req);
  const { role } = body(req, updateMemberSchema);
  const targetId = parse(z.string().regex(/^[a-f0-9]{24}$/), req.params.userId);
  const target = await Membership.findOne({ orgId: c.orgId, userId: targetId });
  if (!target) throw notFound('Member');
  const allowed = assignableRoles(c.role);
  if (!allowed.includes(role) || !allowed.includes(target.role as OrgRole)) throw forbidden('You cannot assign or change that role.');
  if (target.role === 'owner' && role !== 'owner' && (await ownerCount(c.orgId)) <= 1) throw new AppError('conflict', 'An organization needs at least one owner.');
  const before = target.role;
  target.role = role;
  await target.save();
  await audit(c.orgId, userActor(c.userId), 'member.role_changed', { type: 'user', id: targetId }, { from: before, to: role });
  res.json(ok({ userId: targetId, role }));
});

org.delete('/members/:userId', requirePermission('members:manage'), async (req, res) => {
  const c = ctx(req);
  const targetId = parse(z.string().regex(/^[a-f0-9]{24}$/), req.params.userId);
  const target = await Membership.findOne({ orgId: c.orgId, userId: targetId });
  if (!target) throw notFound('Member');
  if (!assignableRoles(c.role).includes(target.role as OrgRole)) throw forbidden('You cannot remove that member.');
  if (target.role === 'owner' && (await ownerCount(c.orgId)) <= 1) throw new AppError('conflict', 'An organization needs at least one owner.');
  await Membership.deleteOne({ orgId: c.orgId, userId: targetId });
  await audit(c.orgId, userActor(c.userId), 'member.removed', { type: 'user', id: targetId });
  res.json(ok({ removed: true }));
});

// ---------- Invitations ----------

org.get('/invitations', requirePermission('members:manage'), async (req, res) => {
  const inv = await Invitation.find({ orgId: ctx(req).orgId, acceptedAt: null, revokedAt: null }).sort({ createdAt: -1 }).lean();
  res.json(ok(inv.map((i) => ({ id: String(i._id), email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expiresAt < new Date() }))));
});

org.post('/invitations', requirePermission('members:manage'), requireVerifiedEmail, emailLimiter, async (req, res) => {
  const c = ctx(req);
  const input = body(req, inviteSchema);
  if (!assignableRoles(c.role).includes(input.role)) throw forbidden('You cannot invite someone with that role.');
  const existingUser = await User.findOne({ email: input.email }, { _id: 1 }).lean();
  if (existingUser && (await Membership.exists({ orgId: c.orgId, userId: existingUser._id }))) throw new AppError('conflict', 'That person is already a member.');
  await Invitation.updateMany({ orgId: c.orgId, email: input.email, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await assertCanAdd(c.orgId, 'seats');
  const token = randomToken(32);
  const inv = await Invitation.create({ orgId: c.orgId, email: input.email, role: input.role, tokenHash: sha256(token), invitedBy: c.userId, expiresAt: new Date(Date.now() + 7 * 86400_000) });
  const o = await Organization.findById(c.orgId, { name: 1 }).lean();
  const mail = await sendEmail({
    to: input.email,
    subject: `You're invited to join ${o?.name} on Closewell`,
    text: `You've been invited to join ${o?.name} as ${input.role.replace('_', ' ')}.\n\nAccept the invitation (valid 7 days):\n${appUrl(`/invite?token=${token}`)}\n`,
  });
  await audit(c.orgId, userActor(c.userId), 'invitation.created', { type: 'invitation', id: inv._id }, { role: input.role });
  res.status(201).json(ok({ id: String(inv._id), email: inv.email, role: inv.role, expiresAt: inv.expiresAt, emailMode: mail.mode }));
});

org.delete('/invitations/:id', requirePermission('members:manage'), async (req, res) => {
  const c = ctx(req);
  const id = parse(z.string().regex(/^[a-f0-9]{24}$/), req.params.id);
  const r = await Invitation.updateOne({ _id: id, orgId: c.orgId, acceptedAt: null }, { $set: { revokedAt: new Date() } });
  if (!r.matchedCount) throw notFound('Invitation');
  await audit(c.orgId, userActor(c.userId), 'invitation.revoked', { type: 'invitation', id });
  res.json(ok({ revoked: true }));
});

// ---------- Accepting invitations (not org-scoped: the token identifies the org) ----------

export const invitationsRouter = Router();

invitationsRouter.get('/:token', async (req, res) => {
  const inv = await Invitation.findOne({ tokenHash: sha256(String(req.params.token)), acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).setOptions({ crossTenant: true }).lean();
  if (!inv) throw notFound('Invitation');
  const o = await Organization.findById(inv.orgId, { name: 1 }).lean();
  res.json(ok({ organization: o?.name, role: inv.role, email: inv.email }));
});

invitationsRouter.post('/accept', requireAuth, async (req, res) => {
  const { token } = body(req, z.object({ token: z.string().min(20).max(200) }));
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new AppError('unauthenticated', 'Sign in to continue');
  const inv = await Invitation.findOne({ tokenHash: sha256(token), acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).setOptions({ crossTenant: true });
  if (!inv) throw notFound('Invitation');
  if (inv.email !== user.email) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
  const claimed = await Invitation.findOneAndUpdate({ _id: inv._id, orgId: inv.orgId, acceptedAt: null }, { $set: { acceptedAt: new Date() } });
  if (!claimed) throw notFound('Invitation');
  if (!(await Membership.exists({ orgId: inv.orgId, userId: user._id }))) {
    await Membership.create({ orgId: inv.orgId, userId: user._id, role: inv.role });
  }
  // Clicking the invitation link proves the user controls this email address.
  if (!user.emailVerifiedAt) await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
  await audit(inv.orgId, userActor(user._id), 'invitation.accepted', { type: 'invitation', id: inv._id }, { role: inv.role });
  res.json(ok({ orgId: String(inv.orgId), role: inv.role }));
});
