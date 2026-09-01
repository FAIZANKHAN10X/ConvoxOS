import { z } from 'zod';
import type { ToolDefinition } from './types';

export const handoffTool: ToolDefinition = {
  name: 'handoff',
  description: 'Hand off the conversation to a human. Call when the user explicitly asks for a human, you cannot confidently answer, or a tool failed and needs escalation.',
  permission: 'HANDOFF',
  schema: z.object({
    reason: z.enum(['requested_human', 'no_knowledge', 'complaint', 'tool_failure', 'uncertainty']).describe('Why handing off'),
    summary: z.string().max(500).optional().describe('Short summary for the human agent'),
  }),
  handler: async (args, ctx) => {
    const { reason, summary } = args as { reason: string; summary?: string };
    if (!ctx.conversationId) return { success: false, error: 'No conversation in context' };
    const handoffSummary = summary ? `AI handoff (${reason}): ${summary}` : `AI handoff: ${reason}`;
    const { error } = await ctx.supabase
      .from('conversations')
      .update({ ai_autoreply_disabled: true, ai_handoff_summary: handoffSummary.slice(0, 500) })
      .eq('id', ctx.conversationId)
      .eq('account_id', ctx.accountId);
    if (error) return { success: false, error: 'Failed to hand off' };
    return { success: true, data: { reason, summary: handoffSummary } };
  },
};
