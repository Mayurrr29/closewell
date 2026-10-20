import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../../lib/errors';
import { htmlToText, normalize } from './text';

export const ALLOWED_UPLOADS: Record<string, { mimes: string[]; kind: 'pdf' | 'text' }> = {
  '.pdf': { mimes: ['application/pdf'], kind: 'pdf' },
  '.txt': { mimes: ['text/plain'], kind: 'text' },
  '.md': { mimes: ['text/markdown', 'text/plain', 'text/x-markdown'], kind: 'text' },
  '.csv': { mimes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'], kind: 'text' },
};

/** Validate by extension, declared type AND content (magic bytes / UTF-8), then extract text. */
export async function extractUpload(file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<string> {
  const ext = (file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const rule = ALLOWED_UPLOADS[ext];
  if (!rule || !rule.mimes.includes(file.mimetype)) {
    throw new AppError('unsupported_media_type', 'Upload a PDF, TXT, MD or CSV file.');
  }
  if (rule.kind === 'pdf') {
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('unsupported_media_type', 'This file is not a valid PDF.');
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const out = normalize(Array.isArray(text) ? text.join('\n\n') : text);
      if (!out) throw new AppError('bad_request', 'No text could be extracted. Scanned PDFs need OCR before upload.');
      return out;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('bad_request', 'This PDF could not be read. It may be encrypted or damaged.');
    }
  }
  try {
    return normalize(new TextDecoder('utf-8', { fatal: true }).decode(file.buffer));
  } catch {
    throw new AppError('unsupported_media_type', 'Text files must be UTF-8 encoded.');
  }
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/**
 * Website URLs are fetched only when "authorized": the host must be the
 * organization's own website domain (or a subdomain of it). DNS results are
 * checked against private ranges to prevent SSRF, redirects are followed
 * manually and re-checked, and size/time are capped.
 */
export function assertUrlAuthorized(rawUrl: string, orgWebsite: string | undefined) {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new AppError('validation_failed', 'Enter a full URL starting with https://');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new AppError('validation_failed', 'Only http and https URLs can be imported.');
  if (u.username || u.password) throw new AppError('validation_failed', 'URLs with credentials are not allowed.');
  if (!orgWebsite) throw new AppError('forbidden', 'Add your website in organization settings before importing pages from it.');
  const site = new URL(orgWebsite).hostname.replace(/^www\./, '');
  const host = u.hostname.toLowerCase();
  if (!(host === site || host.endsWith(`.${site}`))) {
    throw new AppError('forbidden', `You can import pages from ${site} only. Change your website in settings to import from another domain.`);
  }
  return u;
}

export async function fetchAuthorizedUrl(rawUrl: string, orgWebsite: string | undefined, maxBytes = 2 * 1024 * 1024): Promise<{ text: string; finalUrl: string }> {
  let url = assertUrlAuthorized(rawUrl, orgWebsite);
  for (let hop = 0; hop < 4; hop++) {
    if (isIP(url.hostname) ? isPrivateAddress(url.hostname) : (await lookup(url.hostname, { all: true })).some((a) => isPrivateAddress(a.address))) {
      throw new AppError('forbidden', 'That address resolves to a private network and cannot be imported.');
    }
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'ClosewellKnowledgeBot/1.0', accept: 'text/html,text/plain' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = assertUrlAuthorized(new URL(res.headers.get('location')!, url).toString(), orgWebsite);
      continue;
    }
    if (!res.ok) throw new AppError('bad_request', `The page returned HTTP ${res.status}.`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)/.test(type)) throw new AppError('unsupported_media_type', 'Only HTML or plain-text pages can be imported.');
    const reader = res.body!.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError('payload_too_large', 'That page is larger than 2 MB.');
      }
      parts.push(value);
    }
    const raw = Buffer.concat(parts).toString('utf8');
    return { text: type.includes('html') ? htmlToText(raw) : normalize(raw), finalUrl: url.toString() };
  }
  throw new AppError('bad_request', 'Too many redirects.');
}

export { isPrivateAddress };
