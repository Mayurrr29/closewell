import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { coarseIp, parseTrustProxy } from './http';

describe('parseTrustProxy', () => {
  it.each([
    ['2', 2],
    [' 1 ', 1],
    ['true', true],
    ['false', false],
    ['loopback', 'loopback'],
    ['10.0.0.0/8, loopback', '10.0.0.0/8, loopback'],
  ])('%j -> %j', (raw, expected) => expect(parseTrustProxy(raw)).toBe(expected));

  it('with 2 hops (Vercel then Render), req.ip is the visitor', async () => {
    const app = express();
    app.set('trust proxy', parseTrustProxy('2'));
    app.get('/', (req, res) => res.json({ ip: coarseIp(req.ip) }));
    const res = await request(app).get('/').set('x-forwarded-for', '203.0.113.7, 198.51.100.9');
    expect(res.body.ip).toBe('203.0.113.0');
  });
});
