import type { Types } from 'mongoose';
import { logger } from '../lib/logger';
import { AuditLog } from '../models/platform';
import type { Actor } from '../types';

/** Append-only audit trail. Never put secrets or full message bodies in `meta`. */
export async function audit(
  orgId: Types.ObjectId,
  actor: Actor,
  action: string,
  target?: { type: string; id?: string | Types.ObjectId | null },
  meta: Record<string, unknown> = {},
) {
  try {
    await AuditLog.create({ orgId, actor, action, target: target ? { type: target.type, id: target.id ? String(target.id) : undefined } : undefined, meta });
  } catch (err) {
    logger.error({ err, action }, 'Failed to write audit log');
  }
}

export const userActor = (userId: Types.ObjectId | string, label?: string): Actor => ({ type: 'user', id: String(userId), label });
export const AI_ACTOR: Actor = { type: 'ai', label: 'AI agent' };
export const SYSTEM_ACTOR: Actor = { type: 'system', label: 'System' };
