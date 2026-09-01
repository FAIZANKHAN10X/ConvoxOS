import type { AiConfig, ChatMessage, AiUsage } from './types';
import type { ToolRegistry } from './tools/registry';
import type { ToolContext } from './tools/types';
import { generateOpenAiWithTools, generateAnthropicWithTools } from './providers/tools';

export interface AgentRunArgs {
  config: AiConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  registry: ToolRegistry;
  context: ToolContext;
  maxToolTurns?: number;
}

export interface AgentRunResult {
  text: string;
  handoff: boolean;
  handoffReason?: string;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  usage: AiUsage | null;
}

const MAX_TOOL_TURNS = 5;

export async function runAgent(args: AgentRunArgs): Promise<AgentRunResult> {
  const { config, systemPrompt, messages: initialMessages, registry, context, maxToolTurns = MAX_TOOL_TURNS } = args;
  const messages = [...initialMessages];
  const toolCalls: AgentRunResult['toolCalls'] = [];
  let totalUsage: AiUsage | null = null;
  let handoff = false;
  let handoffReason: string | undefined;

  const allowed = new Set(['READ', 'WRITE', 'MESSAGE', 'AUTOMATION', 'HANDOFF'] as const);
  // For now, allow all except we could filter by status/goals
  const toolDefs = registry.listForPermissions(allowed as unknown as Set<import('./tools/types').ToolPermission>);

  for (let turn = 0; turn < maxToolTurns; turn++) {
    const provider = config.provider;
    let result: { text?: string; toolCalls?: Array<{ id: string; name: string; args: unknown }>; usage: AiUsage | null; handoff?: boolean };
    if (provider === 'openai') {
      result = await generateOpenAiWithTools({
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt,
        messages,
        tools: registry.toOpenAITools(allowed as unknown as Set<import('./tools/types').ToolPermission>),
      });
    } else {
      result = await generateAnthropicWithTools({
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt,
        messages,
        tools: registry.toAnthropicTools(allowed as unknown as Set<import('./tools/types').ToolPermission>),
      });
    }

    // Aggregate usage
    if (result.usage) {
      if (!totalUsage) totalUsage = result.usage;
      else {
        totalUsage = {
          promptTokens: (totalUsage.promptTokens ?? 0) + (result.usage.promptTokens ?? 0),
          completionTokens: (totalUsage.completionTokens ?? 0) + (result.usage.completionTokens ?? 0),
          totalTokens: (totalUsage.totalTokens ?? 0) + (result.usage.totalTokens ?? 0),
        };
      }
    }

    if (result.handoff) {
      handoff = true;
      break;
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      // No tools — final answer
      return { text: result.text ?? '', handoff: false, toolCalls, usage: totalUsage };
    }

    // Execute tool calls sequentially
    for (const tc of result.toolCalls) {
      if (tc.name === 'handoff') {
        const res = await registry.execute(tc.name, tc.args, context);
        toolCalls.push({ name: tc.name, args: tc.args, result: res });
        if (res.success) {
          handoff = true;
          handoffReason = (tc.args as { reason?: string })?.reason;
        }
        // Handoff stops execution — don't loop
        if (handoff) break;
        // Also push tool result to messages for LLM to see
        messages.push({
          role: 'assistant',
          content: `Tool ${tc.name} result: ${res.success ? JSON.stringify(res.data) : `Error: ${res.error}`}`,
        } as unknown as ChatMessage);
        // For Anthropic we need proper tool_result, but our wrapper handles via text
        // For now, use simple text injection for both providers
      } else {
        const res = await registry.execute(tc.name, tc.args, context);
        toolCalls.push({ name: tc.name, args: tc.args, result: res });
        const toolResultText = res.success ? `Success: ${JSON.stringify(res.data)}` : `Error: ${res.error}`;
        // Append as assistant tool result for next LLM turn
        // For OpenAI we need to add tool message, for Anthropic tool_result
        // Our providers wrapper will handle converting this to correct format on next iteration
        // For simplicity, we add as user message with tool result
        messages.push({
          role: 'user',
          content: `Tool ${tc.name} returned: ${toolResultText}`,
        });
        if (tc.name === 'handoff' && res.success) {
          handoff = true;
          break;
        }
      }
    }

    if (handoff) break;

    // If we executed tools, loop to get final answer
    // If we reached max turns, break
    if (turn === maxToolTurns - 1) {
      return { text: 'I need to hand this to a human to continue.', handoff: true, handoffReason: 'tool_failure', toolCalls, usage: totalUsage };
    }
  }

  return { text: '', handoff, handoffReason, toolCalls, usage: totalUsage };
}
