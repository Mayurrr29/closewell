import { beforeAll, describe, expect, it } from 'vitest';
import { Conversation, Message, WidgetSession } from '../src/models/conversations';
import { Lead } from '../src/models/sales';
import { originAllowed } from '../src/modules/widget/public';
import { http, publishedOrg, widget } from './helpers';

let ctx: Awaited<ReturnType<typeof publishedOrg>>;
let w: ReturnType<typeof widget>;

beforeAll(async () => {
  ctx = await publishedOrg({ domain: 'shop.example' });
  w = widget(ctx.widgetKey, ctx.origin);
});

describe('website widget (public API)', () => {
  it('serves config only to allowed origins', async () => {
    const res = await w.config().expect(200);
    expect(res.body.data.brandName).toBe('Acme');
    expect(res.headers['access-control-allow-origin']).toBe(ctx.origin);
    await widget(ctx.widgetKey, 'https://evil.example').config().expect(403);
    await http().get(`/api/public/widget/${ctx.widgetKey}/config`).expect(403); // no Origin
    await widget('wk_doesnotexist000000', ctx.origin).config().expect(404);
  });

  it('never exposes secrets or internal configuration', async () => {
    const res = await w.config().expect(200);
    const s = JSON.stringify(res.body);
    expect(s).not.toMatch(/orgId|policies|tools|apiKey|qualification/i);
  });

  it('runs a conversation and continues it across page loads', async () => {
    const start = await w.session().expect(201);
    const token = start.body.data.token;
    expect(start.body.data.messages[0].content).toBe('Hi there!');
    const r = await w.send(token, 'What warranty do panels have?', 'msg-0001').expect(200);
    expect(r.body.data.replies[0].content).toMatch(/25 year/);
    const resumed = await w.session(token).expect(200);
    expect(resumed.body.data.resumed).toBe(true);
    expect(resumed.body.data.messages.length).toBe(3);
  });

  it('is idempotent on clientMessageId (retried send)', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    await w.send(token, 'hello', 'dup-12345678').expect(200);
    const again = await w.send(token, 'hello', 'dup-12345678').expect(200);
    expect(again.body.data.duplicate).toBe(true);
    const s = await WidgetSession.findOne({ orgId: ctx.orgId }).sort({ createdAt: -1 }).lean();
    expect(await Message.countDocuments({ orgId: ctx.orgId, conversationId: s!.conversationId, role: 'customer' })).toBe(1);
    expect(await Message.countDocuments({ orgId: ctx.orgId, conversationId: s!.conversationId, role: 'ai', 'meta.greeting': { $ne: true } })).toBe(1);
  });

  it('streams replies as server-sent events', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    const res = await http()
      .post(`/api/public/widget/${ctx.widgetKey}/messages`)
      .set('origin', ctx.origin)
      .set('authorization', `Bearer ${token}`)
      .set('accept', 'text/event-stream')
      .send({ content: 'How much is the 5kW system?' })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', (c: Buffer) => (d += c.toString()));
        r.on('end', () => cb(null, d));
      })
      .expect(200);
    const text = res.body as string;
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(text).toMatch(/event: ack/);
    expect(text).toMatch(/event: typing/);
    expect(text).toMatch(/event: message\ndata: .*250000 INR/);
    expect(text).toMatch(/event: done/);
  });

  it('stops the AI after a human takes over; the team reply reaches the widget', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    await w.send(token, 'hello', 'take-0001').expect(200);
    const s = await WidgetSession.findOne({ orgId: ctx.orgId }).sort({ createdAt: -1 }).lean();
    const cid = String(s!.conversationId);
    await ctx.api.post(`/conversations/${cid}/takeover`).expect(200);
    const r = await w.send(token, 'are you there?', 'take-0002').expect(200);
    expect(r.body.data.replies).toHaveLength(0);
    expect(r.body.data.withTeam).toBe(true);
    await ctx.api.post(`/conversations/${cid}/messages`, { content: 'Hi, this is Ravi from the team.' }).expect(201);
    const msgs = await w.messages(token).expect(200);
    expect(msgs.body.data.messages.at(-1)).toMatchObject({ role: 'team', content: 'Hi, this is Ravi from the team.' });
    expect(await Message.countDocuments({ orgId: ctx.orgId, conversationId: cid, role: 'ai', createdAt: { $gt: new Date(Date.now() - 5000) }, 'meta.greeting': { $ne: true } })).toBe(1);
    // Resume hands control back to the AI.
    await ctx.api.post(`/conversations/${cid}/resume`, {}).expect(200);
    const after = await w.send(token, 'what about the warranty?', 'take-0003').expect(200);
    expect(after.body.data.replies).toHaveLength(1);
  });

  it('a session token cannot read another conversation or be used from another site', async () => {
    const t1 = (await w.session().expect(201)).body.data.token;
    await w.send(t1, 'my secret question', 'iso-0001').expect(200);
    const t2 = (await w.session().expect(201)).body.data.token;
    const other = await w.messages(t2).expect(200);
    expect(JSON.stringify(other.body)).not.toMatch(/my secret question/);
    // An allowed second domain cannot reuse a token issued to the first.
    await ctx.api.put('/widget', { enabled: true, brandName: 'Acme', greeting: 'Hi there!', primaryColor: '#2563eb', position: 'right', allowedDomains: ['shop.example', 'other.example'], collectContact: 'optional' }).expect(200);
    await widget(ctx.widgetKey, 'https://other.example').messages(t1).expect(401);
    await w.messages('garbage-token-value-123456').expect(401);
  });

  it('records consent from the contact form and creates a lead', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    await w.contact(token, { name: 'Meera', email: 'meera@example.com', consentToContact: true }).expect(200);
    const lead = await Lead.findOne({ orgId: ctx.orgId, email: 'meera@example.com' }).lean();
    expect(lead!.consent?.contactAllowed).toBe(true);
    expect(lead!.source).toBe('web_widget');
    await w.contact(token, { consentToContact: true }).expect(422);
  });

  it('handover pauses the AI', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    await w.handover(token).expect(200);
    const s = await WidgetSession.findOne({ orgId: ctx.orgId }).sort({ createdAt: -1 }).lean();
    const conv = await Conversation.findOne({ _id: s!.conversationId, orgId: ctx.orgId }).lean();
    expect(conv!.aiMode).toBe('paused');
    expect(conv!.escalated).toBe(true);
  });

  it('limits message rate per session', async () => {
    const token = (await w.session().expect(201)).body.data.token;
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await w.send(token, `spam ${i}`)).status);
    expect(statuses).toContain(429);
  });

  it('a disabled widget is unavailable to websites but previewable from the app', async () => {
    await ctx.api.put('/widget', { enabled: false, brandName: 'Acme', greeting: 'Hi there!', primaryColor: '#2563eb', position: 'right', allowedDomains: ['shop.example'], collectContact: 'optional' }).expect(200);
    await w.config().expect(404);
    const preview = await widget(ctx.widgetKey, 'http://app.test').config().expect(200);
    expect(preview.body.data.preview).toBe(true);
  });
});

describe('origin matching', () => {
  it.each([
    ['https://shop.example', ['shop.example'], true],
    ['https://www.shop.example', ['shop.example'], true],
    ['https://a.shop.example', ['*.shop.example'], true],
    ['https://shop.example', ['*.shop.example'], false],
    ['https://shop.example.evil.com', ['shop.example'], false],
    ['https://evilshop.example', ['shop.example'], false],
    ['http://localhost:3000', ['localhost:3000'], true],
    ['http://localhost:4000', ['localhost:3000'], false],
    ['null', ['shop.example'], false],
  ])('%s vs %j -> %s', (origin, allowed, expected) => expect(originAllowed(origin, allowed)).toBe(expected));
});
