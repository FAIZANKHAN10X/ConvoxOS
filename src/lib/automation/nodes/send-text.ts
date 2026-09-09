import { z } from 'zod';

import { ChannelSocketError, dispatchText } from '@/lib/channels/socket';

import { NodeExecutionError } from '../types';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const sendTextConfig = z.object({
  text: z.string().min(1),
  channel: z.enum(['current', 'whatsapp', 'telegram']).default('current'),
});

export const sendTextAction: NodeDefinition<z.infer<typeof sendTextConfig>> = {
  type: 'action.send_text',
  kind: 'action',
  label: 'Send text',
  description: 'Send a text message on the contact conversation',
  category: 'communication',
  configSchema: sendTextConfig,
  preview: 'message',
  summarize(config) {
    const text = config.text.trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const { data: conv, error } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', ctx.contactId)
      .maybeSingle();
    if (error || !conv) {
      return { status: 'fail', error: 'contact has no conversation' };
    }

    let channel: 'whatsapp' | 'telegram' = 'whatsapp';
    if (config.channel === 'telegram' || config.channel === 'whatsapp') {
      channel = config.channel;
    } else {
      const { data: lastMsg } = await db
        .from('messages')
        .select('channel')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = (lastMsg as { channel?: string } | null)?.channel;
      if (last === 'telegram' || last === 'whatsapp') channel = last;
    }

    try {
      const sent = await dispatchText({
        db,
        accountId: ctx.accountId,
        conversationId: conv.id as string,
        channel,
        text: config.text,
      });
      return {
        status: 'ok',
        output: {
          messageId: sent.messageId,
          providerMessageId: sent.providerMessageId,
          channel,
        },
      };
    } catch (error) {
      if (error instanceof ChannelSocketError) {
        throw new NodeExecutionError(error.message, true);
      }
      throw error;
    }
  },
};
