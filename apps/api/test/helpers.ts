import request from 'supertest';
import { createApp } from '../src/app';
import { drain } from '../src/jobs/queue';
import { EmailOutbox } from '../src/models/identity';
import type { AiProvider, GenerateRequest, GenerateResult } from '../src/ai/providers/types';

export const app = createApp();
export const http = () => request(app);
export const APP_ORIGIN = 'http://app.test';

let n = 0;
export const uniqueEmail = (p = 'user') => `${p}${Date.now().toString(36)}${++n}@example.com`;
export const PASSWORD = 'correct-horse-42';

export interface Session {
  token: string;
  userId: string;
  email: string;
  agent: ReturnType<typeof request.agent>;
}

export async function signup(email = uniqueEmail(), name = 'Test User'): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, userId: res.body.data.user.id, email, agent };
}

export async function login(email: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return { token: res.body.data.accessToken, userId: res.body.data.user.id, email, agent };
}

export async function latestEmailToken(to: string, path: string): Promise<string> {
  const m = await EmailOutbox.findOne({ to }).sort({ createdAt: -1 }).lean();
  const match = m?.text?.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`No ${path} email for ${to}`);
  return match[1];
}

/** Verify the email and return a fresh session whose token carries the verified claim. */
export async function verified(s: Session): Promise<Session> {
  const token = await latestEmailToken(s.email, '/verify-email');
  await http().post('/api/auth/verify-email').send({ token }).expect(200);
  return login(s.email);
}

export const auth = (s: Session | string) => ({ authorization: `Bearer ${typeof s === 'string' ? s : s.token}` });

export async function createOrg(s: Session, overrides: Record<string, unknown> = {}) {
  const res = await http()
    .post('/api/orgs')
    .set(auth(s))
    .send({ name: 'Acme Solar', industry: 'local_business', country: 'India', currency: 'INR', timezone: 'Asia/Kolkata', description: 'We design and install rooftop solar systems for homes.', website: 'https://acme-solar.example', ...overrides });
  if (res.status !== 201) throw new Error(`createOrg failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export const orgApi = (s: Session, orgId: string) => ({
  get: (p: string) => http().get(`/api/orgs/${orgId}${p}`).set(auth(s)),
  post: (p: string, body?: object) => {
    const r = http().post(`/api/orgs/${orgId}${p}`).set(auth(s));
    return body === undefined ? r : r.send(body);
  },
  put: (p: string, body: object) => http().put(`/api/orgs/${orgId}${p}`).set(auth(s)).send(body),
  patch: (p: string, body: object) => http().patch(`/api/orgs/${orgId}${p}`).set(auth(s)).send(body),
  del: (p: string) => http().delete(`/api/orgs/${orgId}${p}`).set(auth(s)),
});

export async function getAgent(s: Session, orgId: string) {
  const res = await orgApi(s, orgId).get('/agents').expect(200);
  return res.body.data[0] as { id: string; config: Record<string, any> };
}

export async function updateAgent(s: Session, orgId: string, mutate: (cfg: Record<string, any>) => void) {
  const a = await getAgent(s, orgId);
  const cfg = structuredClone(a.config);
  mutate(cfg);
  const res = await orgApi(s, orgId).put(`/agents/${a.id}/config`, cfg);
  if (res.status !== 200) throw new Error(`updateAgent ${res.status} ${JSON.stringify(res.body)}`);
  return a.id;
}

/** Org with a product, a verified owner, a configured widget and a published agent. */
export async function publishedOrg(opts: { domain?: string; widgetEnabled?: boolean } = {}) {
  let owner = await signup(uniqueEmail('owner'));
  owner = await verified(owner);
  const orgId = await createOrg(owner);
  const api = orgApi(owner, orgId);
  await api.post('/products', { name: 'Home Solar 5kW', kind: 'product', description: 'A 5 kW rooftop system with installation.', pricingModel: 'fixed', price: 250000, currency: 'INR', availability: 'available' }).expect(201);
  await api.post('/knowledge/text', { title: 'Warranty policy', content: 'All panels include a 25 year performance warranty. Inverters carry a 10 year warranty.' }).expect(201);
  await drain();
  await api.post('/onboarding/steps/4').expect(200);
  await api.post('/onboarding/steps/5').expect(200);
  const domain = opts.domain ?? 'shop.example';
  const w = await api.get('/widget').expect(200);
  await api.put('/widget', { enabled: opts.widgetEnabled ?? true, brandName: 'Acme', greeting: 'Hi there!', primaryColor: '#2563eb', position: 'right', allowedDomains: [domain], collectContact: 'optional' }).expect(200);
  const agent = await getAgent(owner, orgId);
  const pg = await api.post(`/agents/${agent.id}/playground`).expect(201);
  await api.post(`/agents/${agent.id}/playground/${pg.body.data.conversationId}/messages`, { content: 'Hello' }).expect(200);
  const pub = await api.post(`/agents/${agent.id}/publish`);
  if (pub.status !== 200) throw new Error(`publish failed ${JSON.stringify(pub.body)}`);
  return { owner, orgId, api, agentId: agent.id, widgetKey: w.body.data.publicKey as string, origin: `https://${domain}` };
}

export function widget(key: string, origin: string) {
  return {
    config: () => http().get(`/api/public/widget/${key}/config`).set('origin', origin),
    session: (resumeToken?: string) => http().post(`/api/public/widget/${key}/sessions`).set('origin', origin).send(resumeToken ? { resumeToken } : {}),
    send: (token: string, content: string, clientMessageId?: string) =>
      http().post(`/api/public/widget/${key}/messages`).set('origin', origin).set('authorization', `Bearer ${token}`).send({ content, clientMessageId }),
    messages: (token: string) => http().get(`/api/public/widget/${key}/messages`).set('origin', origin).set('authorization', `Bearer ${token}`),
    contact: (token: string, body: object) => http().post(`/api/public/widget/${key}/contact`).set('origin', origin).set('authorization', `Bearer ${token}`).send(body),
    handover: (token: string) => http().post(`/api/public/widget/${key}/handover`).set('origin', origin).set('authorization', `Bearer ${token}`).send({}),
  };
}

/** A provider driven by a script: each call gets the next step. */
export class ScriptedProvider implements AiProvider {
  readonly id = 'scripted';
  readonly label = 'Scripted test provider';
  readonly isMock = true;
  calls: GenerateRequest[] = [];
  constructor(private steps: ((req: GenerateRequest) => Partial<GenerateResult> | Promise<Partial<GenerateResult>>)[]) {}
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);
    if (req.purpose === 'summary') return { content: '{"summary":"s","nextAction":"n"}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'mock-v1' };
    const step = this.steps.shift();
    const r = step ? await step(req) : { content: 'OK.' };
    return { content: r.content ?? '', toolCalls: r.toolCalls ?? [], usage: r.usage ?? { inputTokens: 10, outputTokens: 5 }, model: r.model ?? 'mock-v1' };
  }
}

export const toolCall = (name: string, args: object, id = `c_${Math.random().toString(36).slice(2)}`) => ({ id, name, arguments: JSON.stringify(args) });
