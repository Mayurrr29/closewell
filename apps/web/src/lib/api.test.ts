import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setAccessToken } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('api client', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('old');
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization') });
      if (url === '/api/auth/refresh') return json(200, { data: { accessToken: 'new', user: {}, memberships: [] } });
      return new Headers(init.headers).get('authorization') === 'Bearer new' ? json(200, { data: { ok: true } }) : json(401, { error: { code: 'unauthenticated', message: 'expired' } });
    }));
    await expect(api.get('/orgs/x')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/orgs/x', '/api/auth/refresh', '/api/orgs/x']);
  });

  it('turns server validation errors into field errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { error: { code: 'validation_failed', message: 'Some fields need attention', details: { fields: { email: 'Enter a valid email address' } } } })));
    const err = await api.post('/auth/register', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fields.email).toBe('Enter a valid email address');
  });

  it('explains network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.get('/x')).rejects.toThrow(/Could not reach the server/);
  });
});
