import { z } from 'zod';
import type { ToolDefinition } from './types';
import { engineSendText } from '@/lib/flows/meta-send';

export const sendMessageTool: ToolDefinition = {
  name: 'send_message',
  description: 'Send a text message to the current conversation. Use for share_link goals or when the user requests a resource.',
  permission: 'MESSAGE',
  schema: z.object({
    text: z.string().min(1).max(2000),
    channel: z.enum(['whatsapp', 'telegram']).optional().describe('Channel to send on (defaults to current conversation channel)'),
  }),
  handler: async (args, ctx) => {
    const { text } = args as { text: string; channel?: string };
    if (!ctx.conversationId || !ctx.contactId) return { success: false, error: 'No conversation in context' };
    // Verify conversation belongs to account
    const { data: conv } = await ctx.supabase.from('conversations').select('id, status').eq('id', ctx.conversationId).eq('account_id', ctx.accountId).maybeSingle();
    if (!conv) return { success: false, error: 'Conversation not found' };
    if (conv.status === 'closed') return { success: false, error: 'Conversation is closed' };
    try {
      await engineSendText({
        accountId: ctx.accountId,
        userId: '00000000-0000-0000-0000-000000000000', // system
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        text,
        aiGenerated: true,
      });
      return { success: true, data: { sent: true } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to send message' };
    }
  },
};
