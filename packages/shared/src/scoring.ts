/**
 * Rule-based lead fit score (0–100).
 *
 * This is a transparent checklist of how much we know about a lead and
 * whether it matches the organization's stated criteria. It is NOT a
 * prediction of whether the lead will buy. The rules are documented in
 * docs/lead-scoring.md and shown in the UI next to every score.
 *
 * | Rule                    | Max | How points are earned                                      |
 * |-------------------------|-----|------------------------------------------------------------|
 * | Qualification answers   | 40  | Share of configured question weight that has an answer     |
 * | Contact details         | 15  | Email 10, phone 5                                          |
 * | Requirements described  | 15  | Requirements text of at least 15 characters               |
 * | Budget                  | 15  | Stated 10, +5 if at/above the configured minimum (or none) |
 * | Timeline                | 15  | Stated 10, +5 if within the configured max days (or none)  |
 *
 * A stated budget below the configured minimum earns 0 for the budget rule.
 */
export interface ScoringConfig {
  qualificationQuestions: { key: string; weight: number }[];
  budgetMinimum: number | null;
  timelineMaxDays: number | null;
  qualifiedThreshold: number;
}

export interface ScoringInput {
  email?: string | null;
  phone?: string | null;
  requirements?: string | null;
  budgetAmount?: number | null;
  timeline?: string | null;
  qualificationAnswers?: Record<string, string | undefined>;
}

export interface ScoreLine {
  rule: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  qualified: boolean;
  breakdown: ScoreLine[];
}

/** Parse "2 weeks", "within 3 months", "30 days", "asap" into days. Returns null if unclear. */
export function parseTimelineDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(asap|immediately|right away|today|now|urgent)\b/.test(t)) return 0;
  if (/\bthis week\b/.test(t)) return 7;
  if (/\bthis month\b/.test(t)) return 30;
  if (/\bnext month\b/.test(t)) return 60;
  if (/\bthis quarter\b/.test(t)) return 90;
  if (/\bthis year\b/.test(t)) return 365;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month|quarter|year)s?/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { day: 1, week: 7, month: 30, quarter: 90, year: 365 }[m[2] as 'day'];
  return Math.round(n * unit);
}

export function scoreLead(input: ScoringInput, config: ScoringConfig): ScoreResult {
  const breakdown: ScoreLine[] = [];

  const totalWeight = config.qualificationQuestions.reduce((s, q) => s + q.weight, 0);
  if (totalWeight > 0) {
    const answers = input.qualificationAnswers ?? {};
    const answered = config.qualificationQuestions.filter((q) => (answers[q.key] ?? '').trim().length > 0);
    const w = answered.reduce((s, q) => s + q.weight, 0);
    breakdown.push({
      rule: 'Qualification answers',
      points: Math.round((40 * w) / totalWeight),
      max: 40,
      detail: `${answered.length} of ${config.qualificationQuestions.length} questions answered`,
    });
  } else {
    breakdown.push({ rule: 'Qualification answers', points: 0, max: 40, detail: 'No qualification questions configured' });
  }

  const contact = (input.email ? 10 : 0) + (input.phone ? 5 : 0);
  breakdown.push({
    rule: 'Contact details',
    points: contact,
    max: 15,
    detail: [input.email ? 'email' : null, input.phone ? 'phone' : null].filter(Boolean).join(' and ') || 'none provided',
  });

  const req = (input.requirements ?? '').trim();
  breakdown.push({ rule: 'Requirements described', points: req.length >= 15 ? 15 : 0, max: 15, detail: req.length >= 15 ? 'described' : 'not yet described' });

  if (input.budgetAmount === null || input.budgetAmount === undefined) {
    breakdown.push({ rule: 'Budget', points: 0, max: 15, detail: 'not stated' });
  } else if (config.budgetMinimum !== null && input.budgetAmount < config.budgetMinimum) {
    breakdown.push({ rule: 'Budget', points: 0, max: 15, detail: `below the configured minimum of ${config.budgetMinimum}` });
  } else {
    breakdown.push({ rule: 'Budget', points: 15, max: 15, detail: config.budgetMinimum !== null ? 'meets the configured minimum' : 'stated' });
  }

  const days = parseTimelineDays(input.timeline);
  if (!input.timeline?.trim()) {
    breakdown.push({ rule: 'Timeline', points: 0, max: 15, detail: 'not stated' });
  } else if (config.timelineMaxDays === null) {
    breakdown.push({ rule: 'Timeline', points: 15, max: 15, detail: 'stated' });
  } else if (days !== null && days <= config.timelineMaxDays) {
    breakdown.push({ rule: 'Timeline', points: 15, max: 15, detail: `within ${config.timelineMaxDays} days` });
  } else {
    breakdown.push({ rule: 'Timeline', points: 10, max: 15, detail: days === null ? 'stated, length unclear' : `longer than ${config.timelineMaxDays} days` });
  }

  const score = Math.max(0, Math.min(100, breakdown.reduce((s, l) => s + l.points, 0)));
  return { score, qualified: score >= config.qualifiedThreshold, breakdown };
}
