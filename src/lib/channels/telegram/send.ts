// Provider-specific Telegram text sender — Phase 2 manual outbound only.
// Text-only, no media/templates/interactive. Keeps WhatsApp path untouched.

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, isLegacyFormat, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export class SendTelegramError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendTelegramError';
    this.code = code;
    this.status = status;
  }
}

export interface SendTelegramTextParams {
  conversationId: string;
  contentText: string | null;
  replyToMessageId?: string | null;
}

export interface SendTelegramTextResult {
  messageId: string; // our messages.id
  telegramMessageId: string; // provider id tg_<chat>_<id>
}

const TELEGRAM_TEXT_LIMIT = 4096;

function validateTelegramText(contentText: string | null | undefined) {
  if (!contentText || !contentText.trim()) {
    throw new SendTelegramError('bad_request', 'content_text is required for text messages', 400);
  }
  if (contentText.length > TELEGRAM_TEXT_LIMIT) {
    throw new SendTelegramError('bad_request', `Text exceeds ${TELEGRAM_TEXT_LIMIT} character limit`, 400);
  }
}

export async function sendTelegramText(
  db: SupabaseClient,
  accountId: string,
  params: SendTelegramTextParams
): Promise<SendTelegramTextResult> {
  const { conversationId, contentText, replyToMessageId } = params;

  if (!conversationId) {
    throw new SendTelegramError('bad_request', 'conversation_id is required', 400);
  }
  validateTelegramText(contentText);

  // Load conversation + contact
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendTelegramError('not_found', 'Conversation not found', 404);
  }

  const contact = (conversation as any).contact;
  if (!contact?.telegram_user_id) {
    throw new SendTelegramError('bad_request', 'Contact does not have a Telegram chat', 400);
  }
  const chatId: number = contact.telegram_chat_id ?? contact.telegram_user_id;

  // Load telegram_config for this account
  const { data: config, error: configError } = await db
    .from('telegram_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (configError || !config) {
    throw new SendTelegramError('telegram_not_configured', 'Telegram not configured. Please connect your Telegram bot first.', 400);
  }

  let botToken: string;
  try {
    botToken = decrypt(config.bot_token_encrypted);
  } catch {
    throw new SendTelegramError('decrypt_failed', 'Failed to decrypt Telegram bot token. Please reconnect your bot.', 500);
  }

  // Self-heal legacy format
  if (isLegacyFormat(config.bot_token_encrypted)) {
    void db
      .from('telegram_config')
      .update({ bot_token_encrypted: encrypt(botToken) })
      .eq('id', config.id)
      .then(({ error }: { error: any }) => {
        if (error) console.warn('[telegram-send] bot_token GCM upgrade failed:', error.message);
      });
  }

  // Resolve reply target to Telegram message numeric id if provided
  let replyToTelegramId: number | undefined;
  let replyToInternalId: string | null = null;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (parentError || !parent) {
      throw new SendTelegramError('bad_request', 'reply_to_message_id not found in this conversation', 400);
    }
    replyToInternalId = parent.id as string;
    if (parent.message_id && typeof parent.message_id === 'string' && parent.message_id.startsWith('tg_')) {
      const parts = parent.message_id.split('_');
      const last = parts[parts.length - 1];
      const num = parseInt(last, 10);
      if (!Number.isNaN(num)) replyToTelegramId = num;
    }
    // If parent has no telegram numeric id, send without reply (graceful)
    if (replyToTelegramId === undefined && parent.message_id) {
      console.warn('[telegram-send] reply target has no Telegram numeric id; sending without reply context');
    }
  }

  // Send via Telegram Bot API
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: contentText!,
  };
  if (replyToTelegramId !== undefined) {
    (payload as any).reply_to_message_id = replyToTelegramId;
  }

  let telegramMessageId: number;
  let providerMessageId: string;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as any;
    if (!res.ok || !json.ok) {
      const desc = json?.description || `Telegram API error ${res.status}`;
      throw new Error(desc);
    }
    telegramMessageId = json.result.message_id;
    providerMessageId = `tg_${chatId}_${telegramMessageId}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telegram-send] Telegram send failed:', message);
    // Telegram errors are not retried automatically; surface as 502
    throw new SendTelegramError('telegram_error', `Telegram API error: ${message}`, 502);
  }

  // Persist — distinguish provider success vs DB failure
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: contentText,
      channel: 'telegram',
      message_id: providerMessageId,
      status: 'sent',
      reply_to_message_id: replyToInternalId,
    } as any)
    .select()
    .single();

  if (msgError) {
    console.error('[telegram-send] error inserting sent message:', msgError);
    throw new SendTelegramError('db_error', `Message sent to Telegram but failed to save to DB: ${msgError.message}`, 500);
  }

  // Update conversation preview
  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause active Flow runs (best-effort, same as WA)
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({ status: 'paused_by_agent', ended_at: new Date().toISOString(), end_reason: 'agent_replied' })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) console.error('[telegram-send] pause flow failed:', pauseErr.message);
  } catch (err) {
    console.error('[telegram-send] pause flow threw:', err instanceof Error ? err.message : err);
  }

  return { messageId: messageRecord.id, telegramMessageId: providerMessageId };
}
