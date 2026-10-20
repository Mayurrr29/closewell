import type { Types } from 'mongoose';
import type { OrgRole, Permission } from '@closewell/shared';

export interface AuthInfo {
  userId: string;
  familyId: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
}

export interface TenantContext {
  orgId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrgRole;
  permissions: readonly Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthInfo;
      ctx?: TenantContext;
    }
  }
}

export type Actor = { type: 'user' | 'ai' | 'system' | 'customer'; id?: string; label?: string };
