import { ProviderError, type AiProvider, type ChatMessage, type GenerateRequest, type GenerateResult } from './types';

/**
 * OpenAI Chat Completions adapter (function calling).
 * Docs: https://platform.openai.com/docs/api-reference/chat/create
 * The API key stays on the server; it is never sent to the browser or widget.
 */
export class OpenAiProvider implements AiProvider {
  readonly id = 'openai';
  readonly isMock = false;
  readonly label: string;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {
    this.label = `OpenAI ${model}`;
  }

  private toWire(m: ChatMessage) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!this.apiKey) throw new ProviderError('OPENAI_API_KEY is not configured', 'auth');
    const payload: Record<string, unknown> = {
      model: this.model,
      messages: req.messages.map((m) => this.toWire(m)),
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxOutputTokens ?? 600,
    };
    if (req.tools.length) {
      payload.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      payload.tool_choice = 'auto';
      payload.parallel_tool_calls = false;
    }
    let lastErr: ProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: req.signal,
        });
      } catch (err) {
        if (req.signal.aborted) throw new ProviderError('The AI provider did not respond in time', 'timeout');
        lastErr = new ProviderError(`Network error contacting OpenAI: ${(err as Error).message}`, 'unavailable');
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ProviderError(`OpenAI returned HTTP ${res.status}`, res.status === 429 ? 'rate_limited' : 'unavailable');
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError('OpenAI rejected the API key', 'auth');
      if (!res.ok) throw new ProviderError(`OpenAI returned HTTP ${res.status}`, 'bad_request');
      const json = (await res.json()) as {
        model: string;
        choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const msg = json.choices?.[0]?.message;
      return {
        content: msg?.content ?? '',
        toolCalls: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })),
        usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
        model: json.model ?? this.model,
      };
    }
    throw lastErr ?? new ProviderError('OpenAI unavailable', 'unavailable');
  }
}
