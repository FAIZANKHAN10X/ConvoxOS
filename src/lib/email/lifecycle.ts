import type { SupabaseClient } from '@supabase/supabase-js';

import {
  emitEmailBounced,
  emitEmailDelivered,
  emitEmailOpened,
} from '@/lib/automation/crm-events';

export type ResendLifecycleType =
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened';

/**
 * T7.4: Resend lifecycle → message status + domain events.
 * Only provider-reliable signals that make CRM sense:
 * - delivered → status 'delivered' + email_delivered
 * - bounced/complained → status 'failed' + email_bounced (complaints
 *   share the bounce trigger; suppression lists are ESP territory)
 * - opened → status 'read' + email_opened
 * Sent is implicit, clicks imply opens, delayed is transient — all
 * ignored. Status only advances (failed never overwrites read):
 * out-of-order webhooks resolve deterministically.
 */
export async function handleResendLifecycleEvent(input: {
  db: SupabaseClient;
  accountId: string;
  payload: { type: string; data?: Record<string, unknown> };
}): Promise<{ handled: boolean }> {
  const { db, accountId, payload } = input;
  const type = payload.type;
  if (
    type !== 'email.delivered' &&
    type !== 'email.bounced' &&
    type !== 'email.complained' &&
    type !== 'email.opened'
  ) {
    return { handled: false };
  }
  const data = payload.data ?? {};
  const emailId =
    typeof data.email_id === 'string'
      ? data.email_id
      : typeof data.message_id === 'string'
        ? data.message_id
        : null;
  if (!emailId) return { handled: false };

  const { data: message } = await db
    .from('messages')
    .select('id, status, conversation_id')
    .eq('message_id', `resend_${emailId}`)
    .limit(1)
    .maybeSingle();
  const row = message as {
    id: string;
    status: string;
    conversation_id: string;
  } | null;
  if (!row) return { handled: false };

  const { data: conversation } = await db
    .from('conversations')
    .select('id, contact_id')
    .eq('id', row.conversation_id)
    .eq('account_id', accountId)
    .maybeSingle();
  const conv = conversation as { id: string; contact_id: string } | null;
  if (!conv) return { handled: false };

  const terminal = type === 'email.bounced' || type === 'email.complained';
  const opened = type === 'email.opened';
  const nextStatus = terminal ? 'failed' : opened ? 'read' : 'delivered';
  // Advance-only: failed never overwrites read; delivered never
  // overwrites read/failed; opened applies unless already failed→read.
  const rank: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 2 };
  const currentRank = rank[row.status] ?? 1;
  const nextRank = rank[nextStatus] ?? 1;
  if (nextRank > currentRank) {
    await db.from('messages').update({ status: nextStatus }).eq('id', row.id);
  }

  const common = {
    db,
    accountId,
    contactId: conv.contact_id,
    messageId: row.id,
    payload: { message_id: row.id, email_id: emailId },
  };
  if (type === 'email.delivered') {
    await emitEmailDelivered({
      ...common,
      idempotencyKey: `email_delivered:${row.id}`,
    });
  } else if (terminal) {
    await emitEmailBounced({
      ...common,
      payload: { ...common.payload, reason: type === 'email.complained' ? 'complaint' : 'bounce' },
      idempotencyKey: `email_bounced:${row.id}`,
    });
  } else {
    await emitEmailOpened({
      ...common,
      idempotencyKey: `email_opened:${row.id}`,
    });
  }
  return { handled: true };
}
