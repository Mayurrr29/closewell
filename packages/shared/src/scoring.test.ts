import { describe, expect, it } from 'vitest';
import { parseTimelineDays, scoreLead } from './scoring';

const config = {
  qualificationQuestions: [
    { key: 'team_size', weight: 10 },
    { key: 'use_case', weight: 30 },
  ],
  budgetMinimum: 1000,
  timelineMaxDays: 90,
  qualifiedThreshold: 60,
};

describe('scoreLead', () => {
  it('scores an empty lead at zero', () => {
    const r = scoreLead({}, config);
    expect(r.score).toBe(0);
    expect(r.qualified).toBe(false);
    expect(r.breakdown.reduce((s, l) => s + l.max, 0)).toBe(100);
  });

  it('awards full points for a complete, in-range lead', () => {
    const r = scoreLead(
      {
        email: 'a@b.co',
        phone: '+1 555',
        requirements: 'Need a CRM for 20 reps with phone support',
        budgetAmount: 5000,
        timeline: 'within 2 months',
        qualificationAnswers: { team_size: '20', use_case: 'outbound' },
      },
      config,
    );
    expect(r.score).toBe(100);
    expect(r.qualified).toBe(true);
  });

  it('gives no budget points below the configured minimum', () => {
    const r = scoreLead({ budgetAmount: 200 }, config);
    expect(r.breakdown.find((l) => l.rule === 'Budget')?.points).toBe(0);
  });

  it('weights qualification answers', () => {
    const r = scoreLead({ qualificationAnswers: { use_case: 'x' } }, config);
    expect(r.breakdown[0].points).toBe(30);
  });
});

describe('parseTimelineDays', () => {
  it.each([
    ['asap', 0],
    ['in 2 weeks', 14],
    ['3 months', 90],
    ['next month', 60],
    ['someday', null],
  ])('%s -> %s', (text, days) => expect(parseTimelineDays(text)).toBe(days));
});
