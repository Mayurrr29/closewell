import type { Request } from 'express';
import mongoose, { type Types } from 'mongoose';
import { DEFAULT_PIPELINE_STAGES, scoreLead, type StageType } from '@closewell/shared';
import { AppError, notFound } from '../../lib/errors';
import { Agent } from '../../models/ai';
import { Lead, LeadActivity, Pipeline } from '../../models/sales';
import type { Actor } from '../../types';

export async function getPipeline(orgId: Types.ObjectId) {
  let p = await Pipeline.findOne({ orgId }).lean();
  if (!p) {
    await Pipeline.create({ orgId, stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })) }).catch(() => undefined);
    p = await Pipeline.findOne({ orgId }).lean();
  }
  return p!.stages as { key: string; name: string; type: StageType }[];
}

/** Read scope: reps see leads assigned to them plus unassigned ones; others see all. */
export function leadReadFilter(req: Request): Record<string, unknown> {
  const c = req.ctx!;
  if (c.permissions.includes('leads:read:all')) return { orgId: c.orgId };
  if (c.permissions.includes('leads:read:assigned')) return { orgId: c.orgId, $and: [{ $or: [{ assignedTo: c.userId }, { assignedTo: null }] }] };
  throw new AppError('forbidden', 'You do not have permission to view leads');
}

/** Write scope: reps may edit only leads assigned to them. */
export function leadWriteFilter(req: Request): Record<string, unknown> {
  const c = req.ctx!;
  if (c.permissions.includes('leads:write:all')) return { orgId: c.orgId };
  if (c.permissions.includes('leads:write:assigned')) return { orgId: c.orgId, assignedTo: c.userId };
  throw new AppError('forbidden', 'You do not have permission to change leads');
}

export async function logActivity(orgId: Types.ObjectId, leadId: Types.ObjectId, type: string, actor: Actor, body = '', data: Record<string, unknown> = {}) {
  await LeadActivity.create({ orgId, leadId, type, actor, body, data });
}

export async function scoringConfig(orgId: Types.ObjectId) {
  const agent = await Agent.findOne({ orgId }).sort({ createdAt: 1 }).lean();
  const cfg = (agent?.published ?? agent?.config ?? {}) as Record<string, any>;
  return {
    qualificationQuestions: (cfg.qualificationQuestions ?? []).map((q: { key: string; weight: number }) => ({ key: q.key, weight: q.weight })),
    budgetMinimum: cfg.scoring?.budgetMinimum ?? null,
    timelineMaxDays: cfg.scoring?.timelineMaxDays ?? null,
    qualifiedThreshold: cfg.scoring?.qualifiedThreshold ?? 60,
  };
}

/** Recompute the documented rule-based score and store its breakdown. */
export async function rescore(orgId: Types.ObjectId, leadId: Types.ObjectId) {
  const lead = await Lead.findOne({ _id: leadId, orgId }).lean();
  if (!lead) return null;
  const result = scoreLead(
    {
      email: lead.email,
      phone: lead.phone,
      requirements: lead.requirements,
      budgetAmount: lead.budget?.amount ?? null,
      timeline: lead.timeline,
      qualificationAnswers: lead.qualificationAnswers as Record<string, string>,
    },
    await scoringConfig(orgId),
  );
  await Lead.updateOne({ _id: leadId, orgId }, { $set: { score: result.score, scoreBreakdown: result.breakdown } });
  return result;
}

export async function changeStage(orgId: Types.ObjectId, filter: Record<string, unknown>, leadId: string | Types.ObjectId, stageKey: string, actor: Actor, reason?: string) {
  const stages = await getPipeline(orgId);
  const stage = stages.find((s) => s.key === stageKey);
  if (!stage) throw new AppError('validation_failed', 'Unknown pipeline stage', { fields: { stageKey: 'Choose a stage from your pipeline' } });
  const lead = await Lead.findOne({ ...filter, _id: leadId });
  if (!lead) throw notFound('Lead');
  if (lead.stageKey === stageKey) return lead;
  const from = lead.stageKey;
  lead.stageKey = stage.key;
  lead.stageType = stage.type;
  lead.wonAt = stage.type === 'won' ? new Date() : null;
  lead.lostAt = stage.type === 'lost' ? new Date() : null;
  await lead.save();
  await logActivity(orgId, lead._id, 'stage_change', actor, reason ?? '', { from, to: stage.key });
  return lead;
}

export function serializeLead(l: Record<string, any>) {
  return {
    id: String(l._id),
    name: l.name,
    email: l.email,
    phone: l.phone,
    company: l.company,
    source: l.source,
    industry: l.industry,
    requirements: l.requirements,
    budget: l.budget,
    timeline: l.timeline,
    dealValue: l.dealValue,
    assignedTo: l.assignedTo ? String(l.assignedTo) : null,
    score: l.score,
    scoreBreakdown: l.scoreBreakdown,
    qualificationAnswers: l.qualificationAnswers ?? {},
    stageKey: l.stageKey,
    stageType: l.stageType,
    wonAt: l.wonAt,
    lastContactAt: l.lastContactAt,
    nextFollowUpAt: l.nextFollowUpAt,
    consent: l.consent,
    tags: l.tags,
    isTest: l.isTest,
    conversationIds: (l.conversationIds ?? []).map(String),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

export const oid = (s: string) => new mongoose.Types.ObjectId(s);
