import { Router } from 'express';
import mongoose from 'mongoose';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@closewell/shared';
import { sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { body, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { emailLimiter, loginLimiter, registerLimiter, tokenLimiter } from '../../middleware/rateLimit';
import { Session, User } from '../../models/identity';
import {
  clearRefreshCookie,
  consumeOneTimeToken,
  hashPassword,
  login,
  membershipsFor,
  publicUser,
  revokeFamily,
  rotate,
  sendPasswordReset,
  sendVerification,
  startSession,
} from './service';

export const authRouter = Router();

/** Refresh/logout rely on a SameSite=Strict cookie; the custom header blocks simple cross-site form posts too. */
function requireCsrfHeader(req: import('express').Request) {
  if (req.get('x-requested-with') !== 'closewell') throw new AppError('forbidden', 'Missing request header');
}

authRouter.post('/register', registerLimiter, async (req, res) => {
  const input = body(req, registerSchema);
  if (await User.exists({ email: input.email })) {
    throw new AppError('conflict', 'An account with this email already exists. Sign in or reset your password.');
  }
  const user = await User.create({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
  const mail = await sendVerification(user);
  const accessToken = await startSession(req, res, user);
  res.status(201).json(ok({ user: publicUser(user), accessToken, memberships: [], verificationEmail: mail.mode }));
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = body(req, loginSchema);
  const user = await login(input.email, input.password);
  const accessToken = await startSession(req, res, user);
  res.json(ok({ user: publicUser(user), accessToken, memberships: await membershipsFor(user._id) }));
});

authRouter.post('/refresh', async (req, res) => {
  requireCsrfHeader(req);
  const { user, accessToken } = await rotate(req, res);
  res.json(ok({ user: publicUser(user), accessToken, memberships: await membershipsFor(user._id) }));
});

authRouter.post('/logout', async (req, res) => {
  requireCsrfHeader(req);
  const presented = req.cookies?.cw_rt;
  if (typeof presented === 'string') {
    const s = await Session.findOne({ tokenHash: sha256(presented) });
    if (s) await revokeFamily(s.familyId, 'logout');
  }
  clearRefreshCookie(res);
  res.json(ok({ signedOut: true }));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new AppError('unauthenticated', 'Sign in to continue');
  res.json(ok({ user: publicUser(user), memberships: await membershipsFor(user._id) }));
});

authRouter.post('/verify-email', tokenLimiter, async (req, res) => {
  const { token } = body(req, verifyEmailSchema);
  const userId = await consumeOneTimeToken(token, 'verify_email');
  await User.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
  res.json(ok({ verified: true }));
});

authRouter.post('/resend-verification', requireAuth, emailLimiter, async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new AppError('unauthenticated', 'Sign in to continue');
  if (user.emailVerifiedAt) return res.json(ok({ alreadyVerified: true }));
  const mail = await sendVerification(user);
  res.json(ok({ sent: true, mode: mail.mode }));
});

authRouter.post('/forgot-password', emailLimiter, async (req, res) => {
  const { email } = body(req, forgotPasswordSchema);
  await sendPasswordReset(email);
  res.json(ok({ message: 'If an account exists for that email, a reset link is on its way.' }));
});

authRouter.post('/reset-password', tokenLimiter, async (req, res) => {
  const input = body(req, resetPasswordSchema);
  const userId = await consumeOneTimeToken(input.token, 'reset_password');
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(input.password), failedLogins: 0, lockedUntil: null } });
  // Signing out everywhere: any stolen session dies with the old password.
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'password_reset' } });
  clearRefreshCookie(res);
  res.json(ok({ reset: true }));
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await Session.find({ userId: req.auth!.userId, revokedAt: null, replacedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  res.json(
    ok(
      sessions.map((s) => ({
        id: s.familyId,
        userAgent: s.userAgent,
        ip: s.ip,
        lastUsedAt: s.lastUsedAt,
        createdAt: s.createdAt,
        current: s.familyId === req.auth!.familyId,
      })),
    ),
  );
});

authRouter.delete('/sessions/:familyId', requireAuth, async (req, res) => {
  const familyId = String(req.params.familyId);
  const owned = await Session.exists({ familyId, userId: new mongoose.Types.ObjectId(req.auth!.userId) });
  if (!owned) throw new AppError('not_found', 'Session not found');
  await revokeFamily(familyId, 'user_revoked');
  res.json(ok({ revoked: true }));
});
