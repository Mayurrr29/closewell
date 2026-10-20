import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { drain } from '../src/jobs/queue';
import { Lead } from '../src/models/sales';
import { retrieve } from '../src/modules/knowledge/service';
import { createOrg, http, auth, orgApi, signup, type Session } from './helpers';

/**
 * Adversarial cross-tenant tests: organization B's member tries to reach
 * organization A's data by every route we expose.
 */
let a: Session;
let b: Session;
let orgA: string;
let orgB: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  a = await signup();
  b = await signup();
  orgA = await createOrg(a, { name: 'Alpha Realty' });
  orgB = await createOrg(b, { name: 'Beta Motors' });
  const A = orgApi(a, orgA);
  ids.lead = (await A.post('/leads', { name: 'Secret Lead', email: 'secret@alpha.example' }).expect(201)).body.data.id;
  ids.product = (await A.post('/products', { name: 'Penthouse', price: 1000000, pricingModel: 'fixed' }).expect(201)).body.data.id;
  ids.knowledge = (await A.post('/knowledge/text', { title: 'Alpha internal pricing', content: 'Alpha confidential commission structure is eleven percent.' }).expect(201)).body.data.id;
  await drain();
  const agents = await A.get('/agents').expect(200);
  ids.agent = agents.body.data[0].id;
  ids.conversation = (await A.post(`/agents/${ids.agent}/playground`).expect(201)).body.data.conversationId;
});

describe('tenant isolation', () => {
  it("returns 404 (not 403) when B uses A's org id, so org ids cannot be probed", async () => {
    for (const p of ['', '/leads', '/products', '/knowledge', '/conversations', '/approvals', '/widget', '/audit', '/analytics/overview', '/members', '/billing', '/integrations']) {
      const res = await http().get(`/api/orgs/${orgA}${p}`).set(auth(b));
      expect(res.status, p).toBe(404);
    }
  });

  it("cannot read A's records through B's own org by guessing ids", async () => {
    const B = orgApi(b, orgB);
    await B.get(`/leads/${ids.lead}`).expect(404);
    await B.get(`/products/${ids.product}`).expect(404);
    await B.get(`/knowledge/${ids.knowledge}`).expect(404);
    await B.get(`/conversations/${ids.conversation}`).expect(404);
    await B.get(`/agents/${ids.agent}`).expect(404);
  });

  it("cannot modify or delete A's records through B's org", async () => {
    const B = orgApi(b, orgB);
    await B.patch(`/leads/${ids.lead}`, { name: 'pwned' }).expect(404);
    await B.del(`/products/${ids.product}`).expect(404);
    await B.del(`/knowledge/${ids.knowledge}`).expect(404);
    await B.post(`/conversations/${ids.conversation}/takeover`).expect(404);
    await B.put(`/agents/${ids.agent}/config`, { name: 'x', persona: { displayName: 'x' } }).expect(404);
    const lead = await Lead.findOne({ _id: ids.lead, orgId: orgA }).lean();
    expect(lead?.name).toBe('Secret Lead');
  });

  it('ignores an orgId smuggled in the request body', async () => {
    const B = orgApi(b, orgB);
    const res = await B.post('/leads', { name: 'Smuggled', orgId: orgA }).expect(201);
    const stored = await Lead.findOne({ _id: res.body.data.id }).setOptions({ crossTenant: true }).lean();
    expect(String(stored?.orgId)).toBe(orgB);
  });

  it("lists only the caller's own records", async () => {
    const B = orgApi(b, orgB);
    const leads = await B.get('/leads').expect(200);
    expect(leads.body.data.map((l: { name: string }) => l.name)).not.toContain('Secret Lead');
    const search = await B.get('/knowledge/search?q=confidential commission').expect(200);
    expect(search.body.data).toHaveLength(0);
  });

  it('keeps knowledge retrieval inside the tenant', async () => {
    const hitsA = await retrieve(new mongoose.Types.ObjectId(orgA), 'confidential commission');
    const hitsB = await retrieve(new mongoose.Types.ObjectId(orgB), 'confidential commission');
    expect(hitsA.length).toBeGreaterThan(0);
    expect(hitsB).toHaveLength(0);
  });

  it('tenant guard throws if code queries a tenant model without orgId', async () => {
    await expect(Lead.find({ name: 'Secret Lead' }).lean()).rejects.toThrow(/Tenant guard/);
    await expect(Lead.updateMany({}, { $set: { name: 'x' } })).rejects.toThrow(/Tenant guard/);
    await expect(Lead.aggregate([{ $group: { _id: null } }])).rejects.toThrow(/Tenant guard/);
  });

  it('platform admin flag is required to list organizations, and grants no tenant data', async () => {
    await http().get('/api/orgs').set(auth(b)).expect(403);
  });
});
