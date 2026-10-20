/** Provider-neutral chat + tool-calling interface. Add providers by implementing AiProvider. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as produced by the model; validated server-side before use. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  /** 'summary' requests are short, tool-free summarisation calls. */
  purpose?: 'reply' | 'summary';
}

export interface GenerateResult {
  content: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface AiProvider {
  readonly id: string;
  /** Human-readable label shown in the UI, e.g. "OpenAI gpt-4.1-mini" or "Mock (rule-based, not an LLM)". */
  readonly label: string;
  readonly isMock: boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'rate_limited' | 'unavailable' | 'bad_request' | 'auth',
  ) {
    super(message);
  }
}
