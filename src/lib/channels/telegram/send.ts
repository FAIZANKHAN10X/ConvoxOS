// Provider-specific Telegram text sender — Phase 2 manual outbound only.
// Text-only, no media/templates/interactive. Keeps WhatsApp path untouched.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Json } from '@/types/database';
import { decrypt, isLegacyFormat, encrypt } from '@/lib/crypto/encryption';

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

import type { TelegramInlineMarkup } from './keyboard';
import { validateTelegramInlineMarkup, toTelegramReplyMarkup } from './keyboard';

export interface SendTelegramTextParams {
  conversationId: string;
  contentText: string | null;
  replyToMessageId?: string | null;
  inlineKeyboard?: TelegramInlineMarkup | null;
  /**
   * Stable automation key (run:node:block). Short-circuits on an
   * already-persisted row so engine retries never double-send.
   */
  idempotencyKey?: string | null;
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
  const { conversationId, contentText, replyToMessageId, inlineKeyboard, idempotencyKey } = params;

  if (inlineKeyboard) {
    const v = validateTelegramInlineMarkup(inlineKeyboard);
    if (!v.ok) throw new SendTelegramError('bad_request', v.error, 400);
  }

  if (!conversationId) {
    throw new SendTelegramError('bad_request', 'conversation_id is required', 400);
  }
  validateTelegramText(contentText);

  // Automation retry guard — reuse an already-persisted block send.
  if (idempotencyKey) {
    const { data: existing } = await db
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', conversationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        messageId: existing.id as string,
        telegramMessageId: (existing.message_id as string | null) ?? '',
      };
    }
  }

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

  type TelegramContact = { id: string; telegram_user_id: number | null; telegram_chat_id: number | null };
  const contact = (conversation as unknown as { contact: TelegramContact | null }).contact;
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
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[telegram-send] bot_token GCM upgrade failed:', error.message);
      });
  }

  // Resolve reply target to Telegram message numeric id if provided
  let replyToTelegramId: number | undefined;
  let replyToInternalId: string | null = null;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('id, message_id, conversation_id')
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
    payload.reply_to_message_id = replyToTelegramId;
  }
  const replyMarkup = inlineKeyboard ? toTelegramReplyMarkup(inlineKeyboard) : undefined;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  let telegramMessageId: number;
  let providerMessageId: string;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!res.ok || !json.ok) {
      const desc = json?.description || `Telegram API error ${res.status}`;
      throw new Error(desc);
    }
    if (typeof json.result?.message_id !== 'number') throw new Error('Telegram API returned an invalid message id');
    telegramMessageId = json.result.message_id;
    providerMessageId = `tg_${chatId}_${telegramMessageId}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telegram-send] Telegram send failed:', message);
    // Telegram errors are not retried automatically; surface as 502
    throw new SendTelegramError('telegram_error', `Telegram API error: ${message}`, 502);
  }

  // Persist — distinguish provider success vs DB failure.
  // NOTE: idempotency_key comes from migration 063; regenerate
  // Database types from the DB to drop this cast.
  const hasKeyboard = !!inlineKeyboard;
  const idempotencyPatch = idempotencyKey ? { idempotency_key: idempotencyKey } : {};
  const msgInsert: Database['public']['Tables']['messages']['Insert'] = {
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: hasKeyboard ? 'interactive' : 'text',
    content_text: contentText,
    channel: 'telegram',
    message_id: providerMessageId,
    status: 'sent',
    reply_to_message_id: replyToInternalId,
    ...(hasKeyboard
      ? { interactive_payload: { kind: 'telegram_inline', markup: inlineKeyboard } as unknown as never }
      : {}),
    ...idempotencyPatch,
  } as Database['public']['Tables']['messages']['Insert'];
  const { data: messageRecord, error: msgError } = await db.from('messages').insert(msgInsert).select().single();

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

  // NOTE: flow_runs pause-on-agent was retired with the old flow engine
  // (Phase 9). Manual sends no longer touch automation state.

  return { messageId: messageRecord.id, telegramMessageId: providerMessageId };
}
