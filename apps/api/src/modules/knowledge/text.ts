/**
 * Text utilities for keyword retrieval: normalisation, a light stemmer and a
 * paragraph-aware chunker. Deliberately simple and dependency-free; swap in
 * vector search when the infrastructure supports it (see docs/knowledge.md).
 */

const STOPWORDS = new Set(
  'a an and are as at be but by can could do does for from had has have how i if in into is it its just me my no not of on or our so than that the their them then there these they this to too us was we were what when where which who why will with you your yours about also any been being both did doing each few more most other some such only own same very s t don should now am i\'m'.split(' '),
);

export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stem(w: string): string {
  if (w.length <= 3) return w;
  for (const suf of ['ational', 'ization', 'fulness', 'ousness', 'iveness', 'ments', 'ment', 'ings', 'ing', 'edly', 'ies', 'ied', 'ers', 'er', 'ed', 'ly', 'es', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      const base = w.slice(0, -suf.length);
      return suf === 'ies' || suf === 'ied' ? base + 'y' : base;
    }
  }
  return w;
}

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem);
}

export function uniqueTerms(text: string): string[] {
  return [...new Set(terms(text))];
}

/** Split into ~maxChars chunks on paragraph, then sentence, boundaries, with a small overlap. */
export function chunkText(text: string, maxChars = 900, overlap = 120): string[] {
  const clean = normalize(text);
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= maxChars) pieces.push(p);
    else {
      const sentences = p.match(/[^.!?\n]+[.!?]*\s*/g) ?? [p];
      let cur = '';
      for (const s of sentences) {
        if ((cur + s).length > maxChars && cur) {
          pieces.push(cur.trim());
          cur = '';
        }
        if (s.length > maxChars) {
          for (let i = 0; i < s.length; i += maxChars - overlap) pieces.push(s.slice(i, i + maxChars));
        } else cur += s;
      }
      if (cur.trim()) pieces.push(cur.trim());
    }
  }
  // Merge small neighbouring pieces so chunks carry enough context.
  const chunks: string[] = [];
  let buf = '';
  for (const piece of pieces) {
    if ((buf + '\n\n' + piece).length > maxChars && buf) {
      chunks.push(buf);
      buf = buf.slice(-overlap).replace(/^\S*\s/, '') + '\n\n' + piece;
      if (buf.length > maxChars) buf = piece;
    } else buf = buf ? buf + '\n\n' + piece : piece;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function faqChunks(faqs: { question: string; answer: string }[]): string[] {
  return faqs.map((f) => `Q: ${f.question.trim()}\nA: ${f.answer.trim()}`);
}

export function htmlToText(html: string): string {
  return normalize(
    html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}
