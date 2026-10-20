import mongoose from 'mongoose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setProviderOverride } from '../src/ai/providers';
import { drain } from '../src/jobs/queue';
import { PendingAction } from '../src/models/ai';
import { Message } from '../src/models/conversations';
import { EmailOutbox } from '../src/models/identity';
import { Lead } from '../src/models/sales';
import { expireApprovals } from '../src/modules/approvals/service';
import { ScriptedProvider, createOrg, getAgent, orgApi, signup, toolCall, type Session } from './helpers';

let owner: Session;
let orgId: string;
let agentId: string;
let api: ReturnType<typeof orgApi>;

async function requestDiscount(percent: number) {
  setProviderOverride(new ScriptedProvider([() => ({ toolCalls: [toolCall('offer_discount', { percent, reason: 'asked' })] }), () => ({ content: 'I have asked the team.' })]));
  const cid = (await api.post(`/agents/${agentId}/playground`).expect(201)).body.data.conversationId;
  await api.post(`/agents/${agentId}/playground/${cid}/messages`, { content: 'discount please' }).expect(200);
  const pa = await PendingAction.findOne({ orgId, conversationId: cid }).lean();
  return { cid, id: String(pa!._id) };
}

beforeAll(async () => {
  owner = await signup();
  orgId = await createOrg(owner);
  api = orgApi(owner, orgId);
  agentId = (await getAgent(owner, orgId)).id;
});
afterEach(() => setProviderOverride(null));

describe('approval workflow', () => {
  it('lists, approves and executes exactly once', async () => {
    const { cid, id } = await requestDiscount(25);
    const list = await api.get('/approvals').expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(id);
    await api.post(`/approvals/${id}/approve`, { note: 'ok' }).expect(200);
    await api.post(`/approvals/${id}/approve`).expect(409);
    await drain();
    await drain();
    const pa = await PendingAction.findOne({ _id: id, orgId }).lean();
    expect(pa!.status).toBe('executed');
    expect(await Message.countDocuments({ orgId, conversationId: cid, role: 'human', content: /25% discount/ })).toBe(1);
  });

  it('rejects and tells the customer politely', async () => {
    const { cid, id } = await requestDiscount(35);
    await api.post(`/approvals/${id}/reject`, { note: 'too much' }).expect(200);
    await api.post(`/approvals/${id}/approve`).expect(409);
    expect((await PendingAction.findOne({ _id: id, orgId }).lean())!.status).toBe('rejected');
    expect(await Message.countDocuments({ orgId, conversationId: cid, role: 'human', content: /isn't able to approve/ })).toBe(1);
  });

  it('expires stale requests, which can then not be approved', async () => {
    const { id } = await requestDiscount(45);
    await PendingAction.updateOne({ _id: id, orgId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await api.post(`/approvals/${id}/approve`).expect(409);
    await expireApprovals();
    expect((await PendingAction.findOne({ _id: id, orgId }).lean())!.status).toBe('expired');
  });

  it('deduplicates identical pending requests (idempotency)', async () => {
    setProviderOverride(
      new ScriptedProvider([
        () => ({ toolCalls: [toolCall('offer_discount', { percent: 15, reason: 'asked' })] }),
        () => ({ toolCalls: [toolCall('offer_discount', { percent: 15, reason: 'asked again' })] }),
        () => ({ content: 'Asked the team.' }),
      ]),
    );
    const cid = (await api.post(`/agents/${agentId}/playground`).expect(201)).body.data.conversationId;
    await api.post(`/agents/${agentId}/playground/${cid}/messages`, { content: 'discount' }).expect(200);
    expect(await PendingAction.countDocuments({ orgId, conversationId: cid })).toBe(1);
  });

  it('a failed action is recorded and can be retried after the cause is fixed', async () => {
    const p = await api.post('/products', { name: 'Panel Kit', price: 1000, currency: 'INR' }).expect(201);
    const cid = (await api.post(`/agents/${agentId}/playground`).expect(201)).body.data.conversationId;
    // Lead with email and consent so the quotation can be requested.
    const lead = await api.post('/leads', { name: 'Q', email: 'q@example.com', consent: { contactAllowed: true } }).expect(201);
    await mongoose.connection.collection('conversations').updateOne({ _id: new mongoose.Types.ObjectId(cid) }, { $set: { leadId: new mongoose.Types.ObjectId(lead.body.data.id) } });
    setProviderOverride(new ScriptedProvider([() => ({ toolCalls: [toolCall('send_quotation', { items: [{ productId: p.body.data.id, quantity: 2 }] })] }), () => ({ content: 'The team will review your quote.' })]));
    await api.post(`/agents/${agentId}/playground/${cid}/messages`, { content: 'quote me 2 kits' }).expect(200);
    const pa = await PendingAction.findOne({ orgId, conversationId: cid, tool: 'send_quotation' }).lean();
    expect(pa).toBeTruthy();
    // Customer withdraws consent before approval: execution must fail, not send.
    await Lead.updateOne({ _id: lead.body.data.id, orgId }, { $set: { 'consent.contactAllowed': false } });
    await api.post(`/approvals/${pa!._id}/approve`).expect(200);
    await drain();
    expect((await PendingAction.findOne({ _id: pa!._id, orgId }).lean())!.status).toBe('failed');
    expect(await EmailOutbox.countDocuments({ to: 'q@example.com', subject: /quotation/i })).toBe(0);
    await Lead.updateOne({ _id: lead.body.data.id, orgId }, { $set: { 'consent.contactAllowed': true } });
    await api.post(`/approvals/${pa!._id}/retry`).expect(200);
    await drain();
    const done = await PendingAction.findOne({ _id: pa!._id, orgId }).lean();
    expect(done!.status).toBe('executed');
    expect((done!.result as { total: number }).total).toBe(2000);
    const mail = await EmailOutbox.findOne({ to: 'q@example.com', subject: /quotation/i }).lean();
    expect(mail!.text).toMatch(/2 × Panel Kit @ 1000 INR = 2000 INR/);
  });

  it('read-only analysts cannot decide approvals', async () => {
    const { id } = await requestDiscount(12);
    const analyst = await signup();
    await mongoose.connection.collection('memberships').insertOne({ orgId: new mongoose.Types.ObjectId(orgId), userId: new mongoose.Types.ObjectId(analyst.userId), role: 'analyst' });
    await orgApi(analyst, orgId).post(`/approvals/${id}/approve`).expect(403);
  });
});
