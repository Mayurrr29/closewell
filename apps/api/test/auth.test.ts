import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Session as SessionModel } from '../src/models/identity';
import { app, auth, http, latestEmailToken, login, PASSWORD, signup, uniqueEmail } from './helpers';

const refresh = (agent: ReturnType<typeof request.agent>) => agent.post('/api/auth/refresh').set('x-requested-with', 'closewell');

describe('registration and login', () => {
  it('registers, returns an access token and sets an httpOnly refresh cookie', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({ name: 'Ann', email: uniqueEmail(), password: PASSWORD }).expect(201);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user.emailVerified).toBe(false);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/cw_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects weak passwords and invalid emails with field errors', async () => {
    const res = await http().post('/api/auth/register').send({ name: 'A', email: 'nope', password: 'short' }).expect(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.fields).toHaveProperty('email');
    expect(res.body.error.details.fields).toHaveProperty('password');
  });

  it('rejects duplicate emails', async () => {
    const email = uniqueEmail();
    await signup(email);
    await http().post('/api/auth/register').send({ name: 'B', email, password: PASSWORD }).expect(409);
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const s = await signup();
    const a = await http().post('/api/auth/login').send({ email: s.email, password: 'wrong-password-1' }).expect(401);
    const b = await http().post('/api/auth/login').send({ email: uniqueEmail('ghost'), password: 'wrong-password-1' }).expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('protects routes without a valid token', async () => {
    await http().get('/api/auth/me').expect(401);
    await http().get('/api/auth/me').set(auth('not-a-jwt')).expect(401);
  });
});

describe('refresh-token rotation', () => {
  it('rotates the refresh token on every use', async () => {
    const s = await signup();
    const r1 = await refresh(s.agent).expect(200);
    expect(r1.body.data.accessToken).toBeTypeOf('string');
    await refresh(s.agent).expect(200);
  });

  it('requires the CSRF header', async () => {
    const s = await signup();
    await s.agent.post('/api/auth/refresh').expect(403);
  });

  it('revokes the whole session family when an old refresh token is reused', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ name: 'Ann', email: uniqueEmail(), password: PASSWORD }).expect(201);
    const stolenCookie = String((reg.headers['set-cookie'] as unknown as string[])[0]).split(';')[0];
    const rotated = await refresh(agent).expect(200);
    // Move past the concurrent-tab grace window, then replay the stolen (already rotated) token.
    await SessionModel.updateMany({ userId: reg.body.data.user.id, replacedAt: { $ne: null } }, { $set: { replacedAt: new Date(Date.now() - 60_000) } });
    await http().post('/api/auth/refresh').set('x-requested-with', 'closewell').set('cookie', stolenCookie).expect(401);
    // Everything in the family is now dead, including the legitimate client's new tokens.
    await http().get('/api/auth/me').set(auth(rotated.body.data.accessToken)).expect(401);
    await refresh(agent).expect(401);
  });

  it('treats a near-simultaneous double refresh as a benign race (409), not theft', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ name: 'Ann', email: uniqueEmail(), password: PASSWORD }).expect(201);
    const cookie = String((reg.headers['set-cookie'] as unknown as string[])[0]).split(';')[0];
    await refresh(agent).expect(200);
    await http().post('/api/auth/refresh').set('x-requested-with', 'closewell').set('cookie', cookie).expect(409);
    await refresh(agent).expect(200);
  });

  it('logout revokes the session and its access token', async () => {
    const s = await signup();
    await http().get('/api/auth/me').set(auth(s)).expect(200);
    await s.agent.post('/api/auth/logout').set('x-requested-with', 'closewell').expect(200);
    await http().get('/api/auth/me').set(auth(s)).expect(401);
    await refresh(s.agent).expect(401);
  });
});

describe('email verification and password reset', () => {
  it('verifies email with a one-time token', async () => {
    const s = await signup();
    const token = await latestEmailToken(s.email, '/verify-email');
    await http().post('/api/auth/verify-email').send({ token }).expect(200);
    await http().post('/api/auth/verify-email').send({ token }).expect(400); // single use
    const me = await login(s.email);
    const res = await http().get('/api/auth/me').set(auth(me)).expect(200);
    expect(res.body.data.user.emailVerified).toBe(true);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const a = await http().post('/api/auth/forgot-password').send({ email: uniqueEmail('nobody') }).expect(200);
    const s = await signup();
    const b = await http().post('/api/auth/forgot-password').send({ email: s.email }).expect(200);
    expect(a.body).toEqual(b.body);
  });

  it('resets the password and signs out every session', async () => {
    const s = await signup();
    await http().post('/api/auth/forgot-password').send({ email: s.email }).expect(200);
    const token = await latestEmailToken(s.email, '/reset-password');
    await http().post('/api/auth/reset-password').send({ token, password: 'brand-new-pass-9' }).expect(200);
    await http().get('/api/auth/me').set(auth(s)).expect(401);
    await http().post('/api/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
    await http().post('/api/auth/login').send({ email: s.email, password: 'brand-new-pass-9' }).expect(200);
  });

  it('lists and revokes sessions', async () => {
    const s = await signup();
    const other = await login(s.email);
    const list = await http().get('/api/auth/sessions').set(auth(s)).expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    const target = list.body.data.find((x: { current: boolean }) => !x.current);
    await http().delete(`/api/auth/sessions/${target.id}`).set(auth(s)).expect(200);
    await http().get('/api/auth/me').set(auth(other)).expect(401);
  });
});
