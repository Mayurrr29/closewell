import type { AiProvider, ChatMessage, GenerateRequest, GenerateResult, ToolCall } from './types';

/**
 * MOCK PROVIDER — a deterministic, rule-based simulator. It is NOT a
 * language model. It exists so the whole product (tools, approvals, guards,
 * inbox, widget) can be developed and tested without an API key. It only
 * repeats information returned by tools, so it cannot invent facts.
 * The UI labels every reply produced by it as "Mock AI".
 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const NAME = /\b(?:my name is|i am|i'm|this is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/;
const COMPANY = /\b(?:from|at|work for|company is)\s+([A-Z][\w&.-]*(?:\s[A-Z][\w&.-]*){0,3})/;

let seq = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `mock_${++seq}`, name, arguments: JSON.stringify(args) });
const estimateTokens = (msgs: ChatMessage[]) => Math.ceil(msgs.reduce((s, m) => s + m.content.length, 0) / 4);

function unanswered(system: string): { key: string; question: string }[] {
  const out: { key: string; question: string }[] = [];
  for (const m of system.matchAll(/^- \[([a-z0-9_]+)\] \(unanswered\) (.+)$/gm)) out.push({ key: m[1], question: m[2] });
  return out;
}

function persona(system: string): string {
  return system.match(/^You are (.+?),/m)?.[1] ?? 'the assistant';
}

export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly label = 'Mock AI (rule-based simulator, not a language model)';
  readonly isMock = true;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const out = this.decide(req);
    return { ...out, usage: { inputTokens: estimateTokens(req.messages), outputTokens: Math.ceil(out.content.length / 4) + 10 }, model: 'mock-v1' };
  }

  private decide(req: GenerateRequest): { content: string; toolCalls: ToolCall[] } {
    const msgs = req.messages;
    const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    if (req.purpose === 'summary') {
      const customer = msgs.filter((m) => m.role === 'user').map((m) => m.content).join(' ').slice(0, 280);
      return { content: JSON.stringify({ summary: customer ? `Customer said: ${customer}` : 'No customer messages yet.', nextAction: 'Review the conversation and follow up with the customer.' }), toolCalls: [] };
    }
    const tools = new Set(req.tools.map((t) => t.name));
    let lastUser = -1;
    msgs.forEach((m, i) => m.role === 'user' && (lastUser = i));
    const user = lastUser >= 0 ? msgs[lastUser].content : '';
    const lower = user.toLowerCase();
    const after = msgs.slice(lastUser + 1);
    const results = after.filter((m) => m.role === 'tool');
    const pending = unanswered(system);

    if (!results.length) {
      if (lastUser < 0) return { content: `Hi! I'm ${persona(system)}. How can I help you today?`, toolCalls: [] };
      const details: Record<string, unknown> = {};
      const email = user.match(EMAIL)?.[0];
      const phone = user.replace(EMAIL, '').match(PHONE)?.[1];
      const name = user.match(NAME)?.[1];
      const company = user.match(COMPANY)?.[1];
      if (email) details.email = email;
      if (phone) details.phone = phone.trim();
      if (name) details.name = name;
      if (company) details.company = company;
      if (Object.keys(details).length && tools.has('record_lead_details')) return { content: '', toolCalls: [call('record_lead_details', details)] };

      if (/\b(discount|cheaper|deal|coupon|% off|lower (the )?price)\b/.test(lower) && tools.has('offer_discount')) {
        const pct = Number(lower.match(/(\d{1,2})\s?%/)?.[1] ?? 10);
        return { content: '', toolCalls: [call('offer_discount', { percent: pct, reason: 'Customer asked for a discount' })] };
      }
      if (/\b(refund|payment terms|net \d+|contract|invoice later|pay later)\b/.test(lower) && tools.has('propose_custom_terms')) {
        return { content: '', toolCalls: [call('propose_custom_terms', { type: /refund/.test(lower) ? 'refund' : /contract/.test(lower) ? 'contract' : 'payment_terms', details: user.slice(0, 300) })] };
      }
      // Answer to the question we asked last turn?
      const prevAssistant = [...msgs.slice(0, lastUser)].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
      const asked = pending.find((q) => prevAssistant.includes(q.question));
      if (asked && tools.has('record_qualification_answer') && !/\?\s*$/.test(user)) {
        return { content: '', toolCalls: [call('record_qualification_answer', { questionKey: asked.key, answer: user.slice(0, 500) })] };
      }
      if (/\b(price|prices|pricing|cost|costs|how much|plan|plans|product|products|buy|package|packages|catalog|catalogue)\b/.test(lower) && tools.has('get_products')) {
        return { content: '', toolCalls: [call('get_products', { query: user.slice(0, 120) })] };
      }
      if ((/\?/.test(user) || /\b(what|how|when|where|do you|can you|is there|policy|shipping|delivery|support|hours)\b/.test(lower)) && tools.has('search_knowledge')) {
        return { content: '', toolCalls: [call('search_knowledge', { query: user.slice(0, 200) })] };
      }
      const next = pending[0];
      return { content: next ? `Thanks for sharing that. ${next.question}` : 'Thanks! Is there anything else you would like to know?', toolCalls: [] };
    }

    // Compose a reply strictly from tool results.
    const last = results[results.length - 1];
    const callName = after.find((m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.id === last.toolCallId))?.toolCalls?.find((t) => t.id === last.toolCallId)?.name;
    let data: any = {};
    try {
      data = JSON.parse(last.content);
    } catch {
      /* ignore */
    }
    const followUp = pending[0] ? ` ${pending[0].question}` : '';
    if (!data.ok) return { content: `I'm not able to do that here, but I can connect you with our team if you'd like.`, toolCalls: [] };
    const d = data.data ?? {};
    switch (callName) {
      case 'search_knowledge': {
        const top = d.results?.[0];
        if (!top) return { content: `I don't have verified information about that, so I don't want to guess. I can ask our team to confirm — would that help?`, toolCalls: [] };
        const raw = String(top.text);
        const faq = raw.match(/^Q: [^\n]*\nA: ([\s\S]*)$/);
        const text = (faq ? faq[1] : raw).replace(/\s+/g, ' ').trim().slice(0, 320);
        return { content: faq ? `${text}${followUp}` : `Here's what our information says (${top.title}): ${text}${followUp}`, toolCalls: [] };
      }
      case 'get_products': {
        const ps = (d.products ?? []) as any[];
        if (!ps.length) return { content: `I couldn't find a matching product or service in our catalogue. Could you tell me a bit more about what you need?`, toolCalls: [] };
        const lines = ps.slice(0, 4).map((p) => `• ${p.name}: ${p.priceText}${p.availability !== 'available' ? ` (${p.availability})` : ''}`);
        return { content: `Here are the options that match:\n${lines.join('\n')}${followUp ? `\n\n${followUp.trim()}` : ''}`, toolCalls: [] };
      }
      case 'record_lead_details':
        return { content: `Thanks, I've noted your details.${followUp || ' How else can I help?'}`, toolCalls: [] };
      case 'record_qualification_answer':
        return { content: `Got it, thank you.${followUp || ' That gives me a good picture. Would you like our team to follow up with next steps?'}`, toolCalls: [] };
      case 'offer_discount':
        if (d.status === 'approved_within_policy') return { content: `Good news: I can offer you ${d.percent}% off.${followUp}`, toolCalls: [] };
        return { content: `I can't approve discounts myself, so I've passed your request to our team. They'll reply here once they've reviewed it.`, toolCalls: [] };
      case 'propose_custom_terms':
        return { content: `That needs a decision from our team, so I've sent them your request. They'll get back to you here.`, toolCalls: [] };
      case 'request_human_handoff':
        return { content: `I've asked a member of our team to join this conversation. They'll reply here shortly.`, toolCalls: [] };
      case 'update_lead_stage':
        return { content: `Thanks! I've updated our records.${followUp}`, toolCalls: [] };
      case 'send_quotation':
        return { content: `I've prepared a quotation request; our team will review it before it's sent to you.`, toolCalls: [] };
      default:
        return { content: `Thanks! How else can I help?`, toolCalls: [] };
    }
  }
}
