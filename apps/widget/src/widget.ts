/**
 * Closewell website chat widget.
 * Embed: <script src="https://YOUR-API/widget.js" data-closewell-key="wk_..." async></script>
 *
 * - Renders inside a Shadow DOM so host-page CSS cannot break it (and vice versa).
 * - Holds no secrets: the widget key is public; the visitor session token
 *   only grants access to this visitor's own conversation.
 * - Streams replies (Server-Sent Events over fetch), resumes the
 *   conversation on reload, polls for team replies, retries on failure.
 */
type Role = 'customer' | 'assistant' | 'team';
interface Msg { id: string; role: Role; content: string; createdAt: string; pending?: boolean; failed?: boolean }
interface Config { brandName: string; greeting: string; primaryColor: string; position: 'left' | 'right'; collectContact: 'off' | 'optional' | 'before_chat'; assistantName: string; teamOnline: boolean; offlineMessage: string; available: boolean; preview: boolean }

(function () {
  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-closewell-key]');
  if (!script || (window as unknown as { __closewell?: boolean }).__closewell) return;
  (window as unknown as { __closewell?: boolean }).__closewell = true;
  const KEY = script.dataset.closewellKey ?? '';
  let API = '__CLOSEWELL_API__';
  if (API.startsWith('__')) API = new URL(script.src).origin;
  const base = `${API}/api/public/widget/${encodeURIComponent(KEY)}`;
  const storeKey = `closewell:${KEY}`;

  const store = {
    get(): string | null {
      try { return localStorage.getItem(storeKey); } catch { return null; }
    },
    set(v: string | null) {
      try { v ? localStorage.setItem(storeKey, v) : localStorage.removeItem(storeKey); } catch { /* storage blocked: session lasts for this page only */ }
    },
  };

  let cfg: Config | null = null;
  let token: string | null = null;
  let messages: Msg[] = [];
  let open = false;
  let busy = false;
  let withTeam = false;
  let contactCollected = false;
  let showContact = false;
  let pollTimer: number | undefined;
  let banner = '';
  let draft = '';

  const host = document.createElement('div');
  host.setAttribute('data-closewell-widget', '');
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const fmt = (s: string) => esc(s).replace(/\n/g, '<br>');
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  async function api(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string>) };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let msg = 'Something went wrong. Please try again.';
      try { msg = (await res.json()).error?.message ?? msg; } catch { /* ignore */ }
      const err = new Error(msg) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function ensureSession() {
    if (token) return;
    const res = await api('/sessions', { method: 'POST', body: JSON.stringify({ resumeToken: store.get() ?? undefined }) });
    const { data } = await res.json();
    token = data.token;
    store.set(token);
    messages = data.messages;
    contactCollected = data.contactCollected;
    showContact = cfg?.collectContact === 'before_chat' && !contactCollected;
  }

  function css(color: string) {
    return `
:host{all:initial}
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.launcher{position:fixed;bottom:20px;${cfg?.position === 'left' ? 'left' : 'right'}:20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:0;background:${color};color:#fff;cursor:pointer;box-shadow:0 6px 24px rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}
.launcher:hover{transform:scale(1.05)}
.launcher:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid ${color};outline-offset:2px}
.panel{position:fixed;bottom:88px;${cfg?.position === 'left' ? 'left' : 'right'}:20px;z-index:2147483647;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 120px));background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 12px 48px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e2e8f0}
@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0;bottom:0}}
.head{background:${color};color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
.head h2{font-size:15px;margin:0;font-weight:600}
.head p{font-size:12px;margin:2px 0 0;opacity:.9}
.head .x{margin-left:auto;background:transparent;border:0;color:#fff;cursor:pointer;padding:6px;border-radius:8px;font-size:18px;line-height:1}
.badge{font-size:10px;background:rgba(255,255,255,.2);padding:2px 6px;border-radius:99px;margin-left:6px}
.log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}
.m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:normal;word-wrap:break-word}
.m.customer{align-self:flex-end;background:${color};color:#fff;border-bottom-right-radius:4px}
.m.assistant,.m.team{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
.who{font-size:11px;color:#64748b;margin:0 0 2px 2px}
.who.r{align-self:flex-end}
.m.failed{opacity:.6}
.retry{font-size:12px;color:#b91c1c;background:none;border:0;cursor:pointer;align-self:flex-end;text-decoration:underline}
.typing{align-self:flex-start;display:flex;gap:4px;padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:14px}
.typing i{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:b 1.2s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.typing i{animation:none}.launcher{transition:none}}
.banner{font-size:12px;padding:8px 16px;background:#fef3c7;color:#92400e;border-top:1px solid #fde68a}
.foot{border-top:1px solid #e2e8f0;padding:10px;display:flex;gap:8px;background:#fff;align-items:flex-end}
textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:14px;max-height:120px;min-height:40px;color:#0f172a;background:#fff}
.send{background:${color};color:#fff;border:0;border-radius:10px;padding:0 14px;height:40px;font-size:14px;font-weight:600;cursor:pointer}
.send:disabled{opacity:.5;cursor:not-allowed}
.links{display:flex;justify-content:space-between;padding:0 12px 8px;background:#fff;font-size:12px}
.links button{background:none;border:0;color:#475569;cursor:pointer;padding:4px;text-decoration:underline}
.contact{padding:16px;display:flex;flex-direction:column;gap:10px;background:#fff;border-top:1px solid #e2e8f0}
.contact h3{margin:0;font-size:14px}
.contact label{font-size:12px;color:#334155;display:flex;flex-direction:column;gap:4px}
.contact input[type=text],.contact input[type=email],.contact input[type=tel]{border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:14px}
.contact .chk{flex-direction:row;align-items:flex-start;gap:8px}
.contact .row{display:flex;gap:8px}
.err{color:#b91c1c;font-size:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mock{font-size:11px;color:#64748b;text-align:center;padding:4px;background:#fff}
`;
  }

  const icon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function render() {
    if (!cfg) return;
    const name = esc(cfg.brandName || 'Chat');
    const log = messages
      .map((m, i) => {
        const prev = messages[i - 1];
        const who = m.role !== prev?.role ? `<div class="who ${m.role === 'customer' ? 'r' : ''}">${m.role === 'customer' ? 'You' : m.role === 'team' ? `${name} team` : esc(cfg!.assistantName)}</div>` : '';
        const retry = m.failed ? `<button class="retry" data-retry="${m.id}">Not sent. Tap to retry</button>` : '';
        return `${who}<div class="m ${m.role}${m.failed ? ' failed' : ''}">${fmt(m.content)}</div>${retry}`;
      })
      .join('');
    root.innerHTML = `<style>${css(cfg.primaryColor)}</style>
<button class="launcher" aria-label="${open ? 'Close chat' : `Chat with ${name}`}" aria-expanded="${open}">${open ? '<span style="font-size:24px" aria-hidden="true">×</span>' : icon}</button>
${open ? `<section class="panel" role="dialog" aria-label="Chat with ${name}">
  <header class="head"><div><h2>${name}${cfg.preview ? '<span class="badge">Preview</span>' : ''}</h2><p>${withTeam ? 'You are chatting with our team' : cfg.teamOnline ? `${esc(cfg.assistantName)} · AI assistant` : `${esc(cfg.assistantName)} · AI assistant · team offline`}</p></div><button class="x" aria-label="Close chat">×</button></header>
  <div class="log" aria-live="polite" aria-relevant="additions">${log}${busy ? '<div class="typing" aria-label="Typing"><i></i><i></i><i></i></div>' : ''}</div>
  ${banner ? `<div class="banner" role="status">${esc(banner)}</div>` : ''}
  ${showContact ? contactForm() : `<div class="foot"><label class="sr" for="cw-in">Message</label><textarea id="cw-in" rows="1" maxlength="2000" placeholder="Type your message…" ${!cfg.available ? 'disabled' : ''}></textarea><button class="send" ${busy || !cfg.available ? 'disabled' : ''}>Send</button></div>
  <div class="links"><button data-act="human" ${withTeam ? 'hidden' : ''}>Talk to a person</button>${cfg.collectContact !== 'off' && !contactCollected ? '<button data-act="contact">Share my contact details</button>' : '<span></span>'}</div>`}
  <div class="mock">AI responses can be wrong. Don't share passwords or payment details.</div>
</section>` : ''}`;
    bind();
    const l = root.querySelector('.log');
    if (l) l.scrollTop = l.scrollHeight;
  }

  function contactForm() {
    return `<form class="contact" novalidate><h3>How can our team reach you?</h3>
<label>Name<input type="text" name="name" autocomplete="name" maxlength="120"></label>
<label>Email<input type="email" name="email" autocomplete="email" maxlength="254"></label>
<label>Phone<input type="tel" name="phone" autocomplete="tel" maxlength="40"></label>
<label class="chk"><input type="checkbox" name="consent"> <span>${esc(cfg!.brandName)} may contact me about my enquiry.</span></label>
<label class="chk"><input type="checkbox" name="marketing"> <span>Send me occasional offers (optional).</span></label>
<div class="err" role="alert"></div>
<div class="row"><button class="send" type="submit">Save</button>${cfg!.collectContact === 'before_chat' ? '' : '<button type="button" data-act="skip" class="send" style="background:#e2e8f0;color:#0f172a">Not now</button>'}</div></form>`;
  }

  function bind() {
    root.querySelector('.launcher')?.addEventListener('click', toggle);
    root.querySelector('.x')?.addEventListener('click', toggle);
    const ta = root.querySelector<HTMLTextAreaElement>('textarea');
    const sendBtn = root.querySelector<HTMLButtonElement>('.foot .send');
    ta?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit(ta.value);
      }
    });
    if (ta) {
      ta.value = draft;
      ta.addEventListener('input', () => (draft = ta.value));
      ta.focus();
      ta.setSelectionRange(draft.length, draft.length);
    }
    sendBtn?.addEventListener('click', () => ta && submit(ta.value));
    root.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = messages.find((x) => x.id === b.dataset.retry);
        if (!m) return;
        messages = messages.filter((x) => x !== m);
        submit(m.content, m.id);
      }),
    );
    root.querySelector('[data-act="human"]')?.addEventListener('click', handover);
    root.querySelector('[data-act="contact"]')?.addEventListener('click', () => ((showContact = true), render()));
    root.querySelector('[data-act="skip"]')?.addEventListener('click', () => ((showContact = false), render()));
    root.querySelector<HTMLFormElement>('form.contact')?.addEventListener('submit', saveContact);
    root.querySelector('.panel')?.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && toggle());
  }

  async function toggle() {
    open = !open;
    banner = '';
    render();
    if (open) {
      try {
        await ensureSession();
        render();
        startPolling();
      } catch (e) {
        banner = (e as Error).message || 'Chat is unavailable right now.';
        render();
      }
    } else {
      stopPolling();
      root.querySelector<HTMLButtonElement>('.launcher')?.focus();
    }
  }

  async function submit(text: string, clientId = uid()) {
    const content = text.trim();
    if (!content || busy) return;
    draft = '';
    const local: Msg = { id: clientId, role: 'customer', content, createdAt: new Date().toISOString(), pending: true };
    messages.push(local);
    busy = true;
    banner = '';
    render();
    try {
      await ensureSession();
      const res = await api('/messages', { method: 'POST', headers: { accept: 'text/event-stream' }, body: JSON.stringify({ content, clientMessageId: clientId }) });
      if ((res.headers.get('content-type') ?? '').includes('text/event-stream') && res.body) await readStream(res.body, local);
      else {
        const { data } = await res.json();
        local.pending = false;
        if (data.messageId) local.id = data.messageId;
        for (const r of data.replies ?? []) addMessage(r);
        withTeam = !!data.withTeam;
      }
    } catch (e) {
      local.failed = true;
      const status = (e as { status?: number }).status;
      if (status === 401) {
        token = null;
        store.set(null);
      }
      banner = (e as Error).message || 'Message not sent.';
    } finally {
      busy = false;
      render();
    }
  }

  async function readStream(body: ReadableStream<Uint8Array>, local: Msg) {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = chunk.match(/^event: (.+)$/m)?.[1];
        const raw = chunk.match(/^data: (.*)$/m)?.[1];
        let data: any = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
        if (ev === 'ack') {
          local.pending = false;
          if (data.messageId) local.id = data.messageId;
          for (const r of data.replies ?? []) addMessage(r);
        } else if (ev === 'message') addMessage(data);
        else if (ev === 'status') withTeam = !!data.withTeam;
        render();
      }
    }
  }

  function addMessage(m: Msg) {
    if (!messages.some((x) => x.id === m.id)) messages.push(m);
  }

  async function poll() {
    if (!token || busy) return;
    try {
      const last = [...messages].reverse().find((m) => !m.pending && !m.failed && !m.id.includes('.'));
      const res = await api(`/messages${last ? `?after=${encodeURIComponent(last.createdAt)}` : ''}`);
      const { data } = await res.json();
      const before = messages.length;
      for (const m of data.messages) addMessage(m);
      const changed = withTeam !== !!data.withTeam || messages.length !== before;
      withTeam = !!data.withTeam;
      if (changed) render();
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        token = null;
        store.set(null);
      }
    }
  }
  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(poll, 4000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
  }

  async function handover() {
    try {
      await ensureSession();
      const res = await api('/handover', { method: 'POST', body: '{}' });
      const { data } = await res.json();
      addMessage(data.message);
      withTeam = true;
      if (cfg?.collectContact !== 'off' && !contactCollected) showContact = true;
    } catch (e) {
      banner = (e as Error).message;
    }
    render();
  }

  async function saveContact(e: Event) {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const fd = new FormData(f);
    const err = f.querySelector('.err')!;
    const email = String(fd.get('email') ?? '').trim();
    const phone = String(fd.get('phone') ?? '').trim();
    if (!email && !phone) return void (err.textContent = 'Enter an email or phone number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (err.textContent = 'Check the email address.');
    if (!fd.get('consent')) return void (err.textContent = 'Tick the box so our team may contact you.');
    try {
      await ensureSession();
      await api('/contact', { method: 'POST', body: JSON.stringify({ name: String(fd.get('name') ?? '').trim() || undefined, email: email || undefined, phone: phone || undefined, consentToContact: true, consentToMarketing: !!fd.get('marketing') }) });
      contactCollected = true;
      showContact = false;
      banner = 'Thanks! Our team can now reach you.';
    } catch (ex) {
      err.textContent = (ex as Error).message;
      return;
    }
    render();
  }

  async function init() {
    try {
      const res = await api('/config');
      cfg = (await res.json()).data;
      render();
    } catch {
      // Disabled widget or domain not allowed: render nothing on the host page.
      host.remove();
    }
  }

  (window as unknown as { Closewell: unknown }).Closewell = { open: () => !open && toggle(), close: () => open && toggle() };
  void init();
})();
