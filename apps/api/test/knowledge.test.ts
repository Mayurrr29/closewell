import { beforeAll, describe, expect, it } from 'vitest';
import { drain } from '../src/jobs/queue';
import { KnowledgeChunk } from '../src/models/knowledge';
import { assertUrlAuthorized, isPrivateAddress } from '../src/modules/knowledge/extract';
import { chunkText } from '../src/modules/knowledge/text';
import { createOrg, orgApi, signup } from './helpers';

let api: ReturnType<typeof orgApi>;
let orgId: string;

beforeAll(async () => {
  const s = await signup();
  orgId = await createOrg(s);
  api = orgApi(s, orgId);
});

describe('knowledge ingestion and retrieval', () => {
  it('indexes text sources and finds them', async () => {
    const res = await api.post('/knowledge/text', { title: 'Shipping', content: 'We ship to all Indian states within 7 business days. Express shipping is not available.' }).expect(201);
    expect(res.body.data.status).toBe('pending');
    await drain();
    const s = await api.get(`/knowledge/${res.body.data.id}`).expect(200);
    expect(s.body.data.status).toBe('ready');
    expect(s.body.data.chunkCount).toBeGreaterThan(0);
    const hits = await api.get('/knowledge/search?q=how long does shipping take').expect(200);
    expect(hits.body.data[0].title).toBe('Shipping');
  });

  it('indexes FAQs as one chunk per question', async () => {
    const res = await api.post('/knowledge/text', { title: 'FAQ', type: 'faq', faqs: [{ question: 'Do you install on weekends?', answer: 'Yes, on Saturdays.' }, { question: 'Is there a site survey?', answer: 'Yes, free of charge.' }] }).expect(201);
    await drain();
    expect(await KnowledgeChunk.countDocuments({ orgId, sourceId: res.body.data.id })).toBe(2);
  });

  it('re-indexes when content changes and drops old chunks', async () => {
    const res = await api.post('/knowledge/text', { title: 'Hours', content: 'Open Monday to Friday.' }).expect(201);
    await drain();
    await api.put(`/knowledge/${res.body.data.id}`, { title: 'Hours', content: 'Open every day including Sunday.' }).expect(200);
    await drain();
    const chunks = await KnowledgeChunk.find({ orgId, sourceId: res.body.data.id }).lean();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toMatch(/Sunday/);
  });

  it('deletes a source and its chunks', async () => {
    const res = await api.post('/knowledge/text', { title: 'Temp', content: 'Temporary content to delete.' }).expect(201);
    await drain();
    await api.del(`/knowledge/${res.body.data.id}`).expect(200);
    expect(await KnowledgeChunk.countDocuments({ orgId, sourceId: res.body.data.id })).toBe(0);
  });

  it('syncs products into knowledge and removes them with the product', async () => {
    const p = await api.post('/products', { name: 'Battery Pack 10kWh', price: 400000, currency: 'INR' }).expect(201);
    await drain();
    const hits = await api.get('/knowledge/search?q=battery pack').expect(200);
    expect(hits.body.data[0].text).toMatch(/400000 INR/);
    await api.del(`/products/${p.body.data.id}`).expect(200);
    expect((await api.get('/knowledge/search?q=battery pack').expect(200)).body.data).toHaveLength(0);
  });

  it('accepts text uploads and validates file types by content', async () => {
    await api.post('/knowledge/upload').attach('file', Buffer.from('Our office is in Ahmedabad.'), { filename: 'office.txt', contentType: 'text/plain' }).expect(201);
    const fake = await api.post('/knowledge/upload').attach('file', Buffer.from('not really a pdf'), { filename: 'evil.pdf', contentType: 'application/pdf' }).expect(415);
    expect(fake.body.error.message).toMatch(/not a valid PDF/);
    await api.post('/knowledge/upload').attach('file', Buffer.from('MZ...'), { filename: 'tool.exe', contentType: 'application/octet-stream' }).expect(415);
    await api.post('/knowledge/upload').attach('file', Buffer.from([0xff, 0xfe, 0x00, 0xd8]), { filename: 'bad.txt', contentType: 'text/plain' }).expect(415);
  });

  it('only imports URLs from the organization website', async () => {
    const res = await api.post('/knowledge/url', { url: 'https://evil.example/page' }).expect(403);
    expect(res.body.error.message).toMatch(/acme-solar.example/);
    expect(() => assertUrlAuthorized('https://docs.acme-solar.example/a', 'https://acme-solar.example')).not.toThrow();
    expect(() => assertUrlAuthorized('file:///etc/passwd', 'https://acme-solar.example')).toThrow();
    expect(() => assertUrlAuthorized('https://acme-solar.example.evil.com', 'https://acme-solar.example')).toThrow();
  });

  it('blocks private network addresses (SSRF)', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('chunks long text on boundaries', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has some sentences. It talks about topic ${i}.`).join('\n\n');
    const chunks = chunkText(text, 400);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });
});
