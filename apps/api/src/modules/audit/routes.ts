import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '@closewell/shared';
import { escapeRegex, paged, query } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { User } from '../../models/identity';
import { AuditLog } from '../../models/platform';

export const auditRouter = Router({ mergeParams: true });

auditRouter.get('/', requirePermission('audit:read'), async (req, res) => {
  const c = ctx(req);
  const { page, pageSize } = query(req, paginationSchema);
  const q = query(req, z.object({ action: z.string().max(60).optional(), actorType: z.enum(['user', 'ai', 'system', 'customer']).optional() }));
  const f: Record<string, unknown> = { orgId: c.orgId };
  if (q.action) f.action = { $regex: `^${escapeRegex(q.action)}` };
  if (q.actorType) f['actor.type'] = q.actorType;
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), AuditLog.countDocuments(f)]);
  const userIds = items.filter((i) => i.actor?.type === 'user' && i.actor.id).map((i) => i.actor!.id!);
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
  res.json(
    paged(
      items.map((i) => ({
        id: String(i._id),
        action: i.action,
        actor: { ...i.actor, label: i.actor?.type === 'user' ? (users.find((u) => String(u._id) === i.actor?.id)?.name ?? i.actor?.label ?? 'User') : i.actor?.label },
        target: i.target,
        meta: i.meta,
        createdAt: i.createdAt,
      })),
      page,
      pageSize,
      total,
    ),
  );
});
