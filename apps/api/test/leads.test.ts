import { beforeAll, describe, expect, it } from 'vitest';
import { Conversation } from '../src/models/conversations';
import { createOrg, orgApi, signup } from './helpers';

let api: ReturnType<typeof orgApi>;

beforeAll(async () => {
  const s = await signup();
  const orgId = await createOrg(s);
  api = orgApi(s, orgId);
});

describe('leads and pipeline', () => {
  it('creates a lead with a documented rule-based score', async () => {
    const res = await api.post('/leads', { name: 'Ravi', email: 'ravi@example.com', requirements: 'Needs a 5 kW system for a two-storey house', budget: { amount: 300000 }, timeline: 'in 2 months' }).expect(201);
    expect(res.body.data.score).toBe(55); // 0 answers + 10 email + 15 req + 15 budget + 15 timeline
    expect(res.body.data.scoreBreakdown.map((l: { rule: string }) => l.rule)).toEqual(['Qualification answers', 'Contact details', 'Requirements described', 'Budget', 'Timeline']);
  });

  it('moves stages, records activity and counts won deals in analytics', async () => {
    const lead = (await api.post('/leads', { name: 'Won Co', dealValue: 120000 }).expect(201)).body.data;
    await api.post(`/leads/${lead.id}/stage`, { stageKey: 'qualified' }).expect(200);
    await api.post(`/leads/${lead.id}/stage`, { stageKey: 'won' }).expect(200);
    await api.post(`/leads/${lead.id}/stage`, { stageKey: 'nonexistent' }).expect(422);
    const detail = await api.get(`/leads/${lead.id}`).expect(200);
    expect(detail.body.data.activities.filter((a: { type: string }) => a.type === 'stage_change')).toHaveLength(2);
    const stats = await api.get('/analytics/overview').expect(200);
    expect(stats.body.data.metrics.won_deals).toBe(1);
    expect(stats.body.data.metrics.recorded_revenue).toBe(120000);
    expect(stats.body.data.definitions.won_deals).toMatch(/AI conversation alone never counts/);
  });

  it('excludes test (simulated) data from analytics', async () => {
    const before = (await api.get('/analytics/overview').expect(200)).body.data.metrics.total_leads;
    await Conversation.create({ orgId: (await api.get('').expect(200)).body.data.id, channel: 'playground', isTest: true });
    const after = (await api.get('/analytics/overview').expect(200)).body.data.metrics;
    expect(after.total_leads).toBe(before);
  });

  it('adds notes and reminders', async () => {
    const lead = (await api.post('/leads', { name: 'Notes' }).expect(201)).body.data;
    await api.post(`/leads/${lead.id}/notes`, { body: 'Called, left voicemail' }).expect(201);
    const due = new Date(Date.now() + 86400_000).toISOString();
    await api.post(`/leads/${lead.id}/reminders`, { dueAt: due, note: 'Call back' }).expect(201);
    const mine = await api.get('/leads/reminders/mine').expect(200);
    expect(mine.body.data[0].leadName).toBe('Notes');
    expect((await api.get(`/leads/${lead.id}`).expect(200)).body.data.nextFollowUpAt).toBe(due);
  });

  it('searches and filters', async () => {
    await api.post('/leads', { name: 'Findable Person', company: 'Zebra Ltd' }).expect(201);
    const res = await api.get('/leads?q=zebra').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect((await api.get('/leads?q=.*').expect(200)).body.data).toHaveLength(0); // regex is escaped
  });

  it('exports CSV with spreadsheet formula injection neutralised', async () => {
    await api.post('/leads', { name: '=HYPERLINK("http://evil")', email: 'x@example.com' }).expect(201);
    const res = await api.get('/leads/export.csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('refuses to remove pipeline stages that still hold leads', async () => {
    const l = (await api.post('/leads', { name: 'In qualified' }).expect(201)).body.data;
    await api.post(`/leads/${l.id}/stage`, { stageKey: 'qualified' }).expect(200);
    const res = await api.put('/pipeline', { stages: [{ key: 'new', name: 'New', type: 'open' }, { key: 'won', name: 'Won', type: 'won' }, { key: 'lost', name: 'Lost', type: 'lost' }] }).expect(409);
    expect(res.body.error.message).toMatch(/qualified|Move leads/);
  });

  it('deletes a lead and scrubs linked conversation contact details', async () => {
    const lead = (await api.post('/leads', { name: 'Forget Me', email: 'forget@example.com' }).expect(201)).body.data;
    const orgId = (await api.get('').expect(200)).body.data.id;
    const conv = await Conversation.create({ orgId, channel: 'web', leadId: lead.id, contact: { name: 'Forget Me', email: 'forget@example.com' } });
    await api.del(`/leads/${lead.id}`).expect(200);
    await api.get(`/leads/${lead.id}`).expect(404);
    const c = await Conversation.findOne({ _id: conv._id, orgId }).lean();
    expect(c!.contact?.email).toBe('');
    expect(c!.leadId).toBeNull();
  });

  it('enforces the product limit on catalogue import', async () => {
    const rows = ['name,price,currency', ...Array.from({ length: 51 }, (_, i) => `Item ${i},${i + 1},INR`)].join('\n');
    const res = await api.post('/products/import').attach('file', Buffer.from(rows), { filename: 'cat.csv', contentType: 'text/csv' }).expect(402);
    expect(res.body.error.code).toBe('limit_exceeded');
    const ok = await api.post('/products/import').attach('file', Buffer.from('name,price,currency,pricing_model\nBasic,100,INR,fixed\nCustom,,,quote_only\n,5,INR,fixed'), { filename: 'cat.csv', contentType: 'text/csv' }).expect(201);
    expect(ok.body.data.created).toBe(2);
    expect(ok.body.data.errors[0].row).toBe(4);
  });
});
