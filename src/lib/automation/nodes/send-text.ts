import { z } from 'zod';

import { ChannelSocketError, dispatchText } from '@/lib/channels/socket';

import { CHANNEL_FIELD_LABELS } from '../present';
import { NodeExecutionError } from '../types';
import type { NodeDefinition } from '../types';
import { resolveConversationChannel } from './channel';
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
  fieldLabels: { channel: CHANNEL_FIELD_LABELS },
  configSchema: sendTextConfig,
  preview: 'message',
  summarize(config) {
    const text = config.text.trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  },
  async execute(ctx, config) {
    const resolved = await resolveConversationChannel(ctx, config.channel);
    if ('error' in resolved) {
      return { status: 'fail', error: resolved.error };
    }
    const { conversationId, channel } = resolved;

    try {
      const sent = await dispatchText({
        db: asDb(ctx),
        accountId: ctx.accountId,
        conversationId,
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
