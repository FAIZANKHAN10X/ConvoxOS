import { AiError, type AiUsage, type ChatMessage } from '../types';
import { normalizeUsage, toNetworkError, providerHttpError, mergeConsecutive } from './shared';
import { aiRequestTimeoutMs, MAX_OUTPUT_TOKENS } from '../defaults';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

interface WithToolsResult {
  text?: string;
  toolCalls?: ToolCall[];
  usage: AiUsage | null;
  handoff?: boolean;
}

export async function generateOpenAiWithTools(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
}): Promise<WithToolsResult> {
  const { apiKey, model, systemPrompt, messages, tools } = args;
  const timeoutMs = aiRequestTimeoutMs();
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...mergeConsecutive(messages).map((m) => ({ role: m.role, content: m.content }))],
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw toNetworkError(err);
  }
  if (!res.ok) throw await providerHttpError('openai', res);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new AiError('Empty response from OpenAI', { code: 'empty_response', status: 502 });
  const usage = normalizeUsage({ prompt: json.usage?.prompt_tokens, completion: json.usage?.completion_tokens, total: json.usage?.total_tokens });
  const toolCalls: ToolCall[] = [];
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      try {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        toolCalls.push({ id: tc.id, name: tc.function.name, args });
      } catch {
        toolCalls.push({ id: tc.id, name: tc.function.name, args: {} });
      }
    }
  }
  const text = msg.content ?? '';
  const handoff = text.includes('[[HANDOFF]]');
  return { text: text.replace('[[HANDOFF]]', '').trim(), toolCalls: toolCalls.length ? toolCalls : undefined, usage, handoff };
}

export async function generateAnthropicWithTools(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}): Promise<WithToolsResult> {
  const { apiKey, model, systemPrompt, messages, tools } = args;
  const timeoutMs = aiRequestTimeoutMs();

  // Anthropic requires user-first and alternation; reuse normalize logic
  const normalized = normalizeForAnthropic(messages);

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: normalized,
  };
  if (tools.length > 0) body.tools = tools;

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw toNetworkError(err);
  }
  if (!res.ok) throw await providerHttpError('anthropic', res);
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const usage = normalizeUsage({ prompt: json.usage?.input_tokens, completion: json.usage?.output_tokens, total: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0) });
  const toolCalls: ToolCall[] = [];
  let text = '';
  for (const block of json.content ?? []) {
    if (block.type === 'text' && block.text) text += block.text;
    else if (block.type === 'tool_use' && block.name) {
      toolCalls.push({ id: block.id ?? `${block.name}-${Date.now()}`, name: block.name, args: block.input ?? {} });
    }
  }
  const handoff = text.includes('[[HANDOFF]]');
  return { text: text.replace('[[HANDOFF]]', '').trim(), toolCalls: toolCalls.length ? toolCalls : undefined, usage, handoff };
}

function normalizeForAnthropic(messages: ChatMessage[]): Array<{ role: string; content: string | Array<{ type: string; text?: string; tool_use_id?: string; content?: string }> }> {
  // Simplified: merge consecutive and ensure user first
  const merged: ChatMessage[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else merged.push({ ...m });
  }
  // Strip leading assistant
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
  if (merged.length === 0) return [{ role: 'user', content: '(The customer has not sent a message yet.)' }];
  return merged.map((m) => ({ role: m.role, content: m.content }));
}
