import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ROLE_PERMISSIONS, type OrgRole, type Permission } from '@closewell/shared';
import { env } from '../config/env';
import { AppError, forbidden, notFound } from '../lib/errors';
import { Membership, Session } from '../models/identity';
import type { TenantContext } from '../types';

interface AccessClaims {
  sub: string;
  fam: string;
  adm?: boolean;
  ver?: boolean;
}

export function signAccessToken(c: AccessClaims): string {
  return jwt.sign(c, env.jwtAccessSecret, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'closewell',
    audience: 'closewell-app',
  });
}

/** Requires a valid, unexpired access token whose session family has not been revoked. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('unauthenticated', 'Sign in to continue'));
  let claims: AccessClaims;
  try {
    claims = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'], issuer: 'closewell', audience: 'closewell-app' }) as AccessClaims;
  } catch {
    return next(new AppError('unauthenticated', 'Your session has expired. Sign in again.'));
  }
  // Revocation check: logout, password reset and refresh-token reuse revoke the whole family.
  const live = await Session.exists({ familyId: claims.fam, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!live) return next(new AppError('unauthenticated', 'Your session has ended. Sign in again.'));
  req.auth = { userId: claims.sub, familyId: claims.fam, isPlatformAdmin: !!claims.adm, emailVerified: !!claims.ver };
  next();
}

/**
 * Resolves the tenant from the :orgId route parameter and verifies, on the
 * server, that the signed-in user is a member. Non-members get 404 so that
 * org ids cannot be probed. Platform admins do NOT bypass this: they have no
 * implicit access to tenant data.
 */
export async function requireOrg(req: Request, _res: Response, next: NextFunction) {
  const raw = String(req.params.orgId ?? '');
  if (!req.auth) return next(new AppError('unauthenticated', 'Sign in to continue'));
  if (!mongoose.isValidObjectId(raw)) return next(notFound('Organization'));
  const orgId = new mongoose.Types.ObjectId(raw);
  const userId = new mongoose.Types.ObjectId(req.auth.userId);
  const m = await Membership.findOne({ orgId, userId }).lean();
  if (!m) return next(notFound('Organization'));
  const role = m.role as OrgRole;
  req.ctx = { orgId, userId, role, permissions: ROLE_PERMISSIONS[role] } satisfies TenantContext;
  next();
}

/** Passes if the member holds ANY of the listed permissions. */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ctx) return next(forbidden());
    if (!perms.some((p) => req.ctx!.permissions.includes(p))) return next(forbidden());
    next();
  };

export function can(req: Request, perm: Permission): boolean {
  return !!req.ctx?.permissions.includes(perm);
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.emailVerified) return next(new AppError('email_not_verified', 'Verify your email address before doing this.'));
  next();
}

export function ctx(req: Request): TenantContext {
  if (!req.ctx) throw new AppError('internal', 'Tenant context missing');
  return req.ctx;
}
