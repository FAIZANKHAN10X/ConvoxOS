import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stable send idempotency for automation retries.
 *
 * Message nodes derive a key per (run, node, block) that is stable
 * across engine attempts. Senders check for an already-persisted row
 * BEFORE calling the provider, so a retry after a partial multi-
 * block send reuses the row instead of double-sending. Manual and
 * dashboard sends pass no key and behave exactly as before.
 */
export interface IdempotentSendHit {
  messageId: string;
  providerMessageId: string;
}

export async function findSentMessage(
  db: SupabaseClient,
  conversationId: string,
  idempotencyKey: string
): Promise<IdempotentSendHit | null> {
  const { data, error } = await db
    .from('messages')
    .select('id, message_id')
    .eq('conversation_id', conversationId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error || !data) return null;
  return {
    messageId: data.id as string,
    providerMessageId: (data.message_id as string | null) ?? '',
  };
}

/** Stable per-block key: same run+node+block reuses, distinct blocks differ. */
export function messageBlockKey(
  runId: string,
  nodeId: string,
  blockId: string
): string {
  return `${runId}:${nodeId}:${blockId}`;
}
