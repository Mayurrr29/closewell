import { Router } from 'express';
import { z } from 'zod';
import { METRIC_DEFINITIONS } from '@closewell/shared';
import { ok, query } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { AgentRun, PendingAction } from '../../models/ai';
import { Conversation } from '../../models/conversations';
import { Organization } from '../../models/identity';
import { Lead } from '../../models/sales';
import { getPipeline } from '../leads/service';
import { estimateCostUsd } from '../../ai/pricing';

export const analyticsRouter = Router({ mergeParams: true });

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every number here is computed from stored records. Test/simulated data is excluded. */
analyticsRouter.get('/overview', requirePermission('analytics:read'), async (req, res) => {
  const c = ctx(req);
  const q = query(req, z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), channel: z.enum(['web', 'whatsapp', 'voice']).optional() }));
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
  const range = { $gte: from, $lte: to };
  const notTest = { $ne: true };
  const org = await Organization.findById(c.orgId, { currency: 1 }).lean();
  const stages = await getPipeline(c.orgId);
  const qIdx = stages.findIndex((s) => s.key === 'qualified');
  const qualifiedKeys = qIdx >= 0 ? stages.filter((s, i) => i >= qIdx && s.type !== 'lost').map((s) => s.key) : stages.filter((s) => s.type === 'won').map((s) => s.key);
  const sourceFilter = q.channel ? { source: q.channel === 'web' ? 'web_widget' : q.channel } : {};
  const convChannel = q.channel ? { channel: q.channel } : { channel: { $ne: 'playground' } };

  const [leads, won, activeConversations, conversations, runs, pendingApprovals] = await Promise.all([
    Lead.find({ orgId: c.orgId, isTest: notTest, createdAt: range, ...sourceFilter }, { createdAt: 1, stageKey: 1, source: 1 }).limit(50_000).lean(),
    Lead.find({ orgId: c.orgId, isTest: notTest, stageType: 'won', wonAt: range, ...sourceFilter }, { dealValue: 1, wonAt: 1 }).limit(50_000).lean(),
    Conversation.countDocuments({ orgId: c.orgId, isTest: notTest, status: 'open', ...convChannel }),
    Conversation.find({ orgId: c.orgId, isTest: notTest, createdAt: range, ...convChannel }, { createdAt: 1, channel: 1, escalated: 1 }).limit(50_000).lean(),
    AgentRun.find({ orgId: c.orgId, isTest: notTest, createdAt: range, status: { $in: ['ok', 'guarded', 'escalated'] }, ...(q.channel ? { channel: q.channel } : {}) }, { model: 1, inputTokens: 1, outputTokens: 1, costUsd: 1, createdAt: 1, flags: 1 }).limit(100_000).lean(),
    PendingAction.countDocuments({ orgId: c.orgId, status: 'pending', expiresAt: { $gt: new Date() } }),
  ]);

  const unpricedRuns = runs.filter((r) => estimateCostUsd(r.model ?? '', 1, 1) === null).length;
  const revenue = won.reduce((s, l) => s + (l.dealValue ?? 0), 0);
  const days: Record<string, { date: string; leads: number; conversations: number; won: number }> = {};
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400_000)) days[dayKey(d)] = { date: dayKey(d), leads: 0, conversations: 0, won: 0 };
  for (const l of leads) days[dayKey(l.createdAt as Date)] && days[dayKey(l.createdAt as Date)].leads++;
  for (const cv of conversations) days[dayKey(cv.createdAt as Date)] && days[dayKey(cv.createdAt as Date)].conversations++;
  for (const l of won) l.wonAt && days[dayKey(l.wonAt)] && days[dayKey(l.wonAt)].won++;
  const byChannel: Record<string, { conversations: number; escalated: number }> = {};
  for (const cv of conversations) {
    byChannel[cv.channel] ??= { conversations: 0, escalated: 0 };
    byChannel[cv.channel].conversations++;
    if (cv.escalated) byChannel[cv.channel].escalated++;
  }
  const bySource: Record<string, number> = {};
  for (const l of leads) bySource[l.source] = (bySource[l.source] ?? 0) + 1;

  res.json(
    ok({
      range: { from, to },
      currency: org?.currency ?? 'USD',
      metrics: {
        total_leads: leads.length,
        qualified_leads: leads.filter((l) => qualifiedKeys.includes(l.stageKey)).length,
        active_conversations: activeConversations,
        conversations: conversations.length,
        won_deals: won.length,
        recorded_revenue: revenue,
        conversion_rate: leads.length ? won.length / leads.length : null,
        ai_messages: runs.length,
        ai_cost: unpricedRuns === runs.length && runs.length ? null : runs.reduce((s, r) => s + (r.costUsd ?? 0), 0),
        ai_cost_unpriced_runs: unpricedRuns,
        guarded_replies: runs.filter((r) => (r.flags ?? []).length).length,
        pending_approvals: pendingApprovals,
      },
      series: Object.values(days),
      byChannel,
      bySource,
      definitions: METRIC_DEFINITIONS,
    }),
  );
});
