import { hash, verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { coarseIp } from '../../lib/http';
import { signAccessToken } from '../../middleware/auth';
import { AuthToken, Membership, Organization, Session, User, type UserDoc } from '../../models/identity';
import { appUrl, sendEmail } from '../../services/email';

export const REFRESH_COOKIE = 'cw_rt';
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP baseline for argon2id
// Pre-computed so unknown-email logins take as long as wrong-password logins.
const DUMMY_HASH = await hash('dummy-password-for-timing', ARGON);

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

export function publicUser(u: Pick<UserDoc, '_id' | 'email' | 'name' | 'emailVerifiedAt' | 'isPlatformAdmin'>) {
  return { id: String(u._id), email: u.email, name: u.name, emailVerified: !!u.emailVerifiedAt, isPlatformAdmin: !!u.isPlatformAdmin };
}

export async function membershipsFor(userId: mongoose.Types.ObjectId | string) {
  const ms = await Membership.find({ userId }).setOptions({ crossTenant: true }).lean();
  const orgs = await Organization.find({ _id: { $in: ms.map((m) => m.orgId) } }, { name: 1, onboarding: 1, industry: 1 }).lean();
  return ms
    .map((m) => {
      const o = orgs.find((x) => String(x._id) === String(m.orgId));
      return o ? { orgId: String(o._id), name: o.name, role: m.role, onboardingComplete: !!o.onboarding?.completedAt } : null;
    })
    .filter(Boolean);
}

function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/api/auth', expires });
}
export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/api/auth' });
}

/** Starts a new session family and returns an access token; sets the refresh cookie. */
export async function startSession(req: Request, res: Response, user: Pick<UserDoc, '_id' | 'isPlatformAdmin' | 'emailVerifiedAt'>) {
  const familyId = randomToken(16);
  return issueTokens(req, res, user, familyId);
}

async function issueTokens(req: Request, res: Response, user: Pick<UserDoc, '_id' | 'isPlatformAdmin' | 'emailVerifiedAt'>, familyId: string) {
  const refresh = randomToken(32);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
  await Session.create({
    userId: user._id,
    familyId,
    tokenHash: sha256(refresh),
    expiresAt,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    ip: coarseIp(req.ip),
    lastUsedAt: new Date(),
  });
  setRefreshCookie(res, refresh, expiresAt);
  return signAccessToken({ sub: String(user._id), fam: familyId, adm: !!user.isPlatformAdmin, ver: !!user.emailVerifiedAt });
}

const REUSE_GRACE_MS = 15_000;

/**
 * Refresh-token rotation with reuse detection. Each refresh token works once.
 * Presenting an already-rotated token (outside a short race window) means it
 * was copied: the whole session family is revoked.
 */
export async function rotate(req: Request, res: Response) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented || typeof presented !== 'string') throw new AppError('unauthenticated', 'Sign in to continue');
  const s = await Session.findOne({ tokenHash: sha256(presented) });
  if (!s || s.expiresAt < new Date()) {
    clearRefreshCookie(res);
    throw new AppError('unauthenticated', 'Your session has expired. Sign in again.');
  }
  if (s.revokedAt) {
    clearRefreshCookie(res);
    throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  }
  if (s.replacedAt) {
    if (Date.now() - s.replacedAt.getTime() < REUSE_GRACE_MS) {
      // Two tabs refreshed at the same moment; the other one already holds the new cookie.
      throw new AppError('conflict', 'Session refreshed in another tab. Retry.');
    }
    await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' } });
    clearRefreshCookie(res);
    throw new AppError('unauthenticated', 'For your security we signed you out. Sign in again.');
  }
  const claimed = await Session.findOneAndUpdate({ _id: s._id, replacedAt: null, revokedAt: null }, { $set: { replacedAt: new Date(), lastUsedAt: new Date() } });
  if (!claimed) throw new AppError('conflict', 'Session refreshed in another tab. Retry.');
  const user = await User.findById(s.userId);
  if (!user) throw new AppError('unauthenticated', 'Sign in to continue');
  const accessToken = await issueTokens(req, res, user, s.familyId);
  return { user, accessToken };
}

export async function revokeFamily(familyId: string, reason: string) {
  await Session.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    await verifyPassword(DUMMY_HASH, password);
    throw new AppError('unauthenticated', 'Email or password is incorrect.');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('rate_limited', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes or reset your password.`);
  }
  const okPw = await verifyPassword(user.passwordHash, password);
  if (!okPw) {
    const failed = (user.failedLogins ?? 0) + 1;
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    throw new AppError('unauthenticated', 'Email or password is incorrect.');
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return user;
}

async function createOneTimeToken(userId: mongoose.Types.ObjectId, type: 'verify_email' | 'reset_password', ttlMs: number) {
  const token = randomToken(32);
  await AuthToken.create({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

export async function consumeOneTimeToken(token: string, type: 'verify_email' | 'reset_password') {
  const t = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!t) throw new AppError('bad_request', type === 'verify_email' ? 'This verification link is invalid or has expired. Request a new one.' : 'This reset link is invalid or has expired. Request a new one.');
  return t.userId;
}

export async function sendVerification(user: Pick<UserDoc, '_id' | 'email' | 'name'>) {
  const token = await createOneTimeToken(user._id, 'verify_email', 48 * 3600_000);
  return sendEmail({
    to: user.email,
    subject: 'Verify your email address',
    text: `Hi ${user.name},\n\nConfirm your email address to finish setting up your account:\n${appUrl(`/verify-email?token=${token}`)}\n\nThis link expires in 48 hours. If you did not create an account, ignore this email.`,
  });
}

export async function sendPasswordReset(email: string) {
  const user = await User.findOne({ email });
  if (!user) return; // do not reveal whether the email exists
  const token = await createOneTimeToken(user._id, 'reset_password', 3600_000);
  await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    text: `Hi ${user.name},\n\nReset your password with this link (valid for 1 hour):\n${appUrl(`/reset-password?token=${token}`)}\n\nIf you did not ask for this, you can ignore this email; your password stays the same.`,
  });
}
