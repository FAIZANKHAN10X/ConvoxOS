import type { SocketChannel } from '@/lib/channels/socket';

import { asDb } from './db';
import type { ExecutionContext } from '../types';

export interface ResolvedConversation {
  conversationId: string;
  channel: SocketChannel;
}

/**
 * Shared conversation + channel resolution for message-sending nodes.
 * `current` follows the thread's last channel, defaulting to WhatsApp.
 * Returns a failure message instead of throwing for missing threads.
 */
export async function resolveConversationChannel(
  ctx: ExecutionContext,
  channelConfig: string | undefined
): Promise<ResolvedConversation | { error: string }> {
  const db = asDb(ctx);
  const { data: conv, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('contact_id', ctx.contactId)
    .maybeSingle();
  if (error || !conv) {
    return { error: 'contact has no conversation' };
  }

  let channel: SocketChannel = 'whatsapp';
  if (channelConfig === 'telegram' || channelConfig === 'whatsapp') {
    channel = channelConfig;
  } else {
    const { data: lastMsg } = await db
      .from('messages')
      .select('channel')
      .eq('conversation_id', (conv as { id: string }).id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = (lastMsg as { channel?: string } | null)?.channel;
    if (last === 'telegram' || last === 'whatsapp') channel = last;
  }

  return { conversationId: (conv as { id: string }).id, channel };
}
