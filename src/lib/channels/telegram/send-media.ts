// Provider-specific Telegram attachment sender — images + documents via URL.
// Keeps WhatsApp path untouched (sendMessageToConversation).

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, isLegacyFormat, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { SendTelegramError } from './send';

export interface SendTelegramMediaParams {
  conversationId: string;
  mediaUrl: string; // public chat-media URL
  mediaKind: 'image' | 'document';
  filename?: string | null;
  caption?: string | null;
  replyToMessageId?: string | null;
}

export interface SendTelegramMediaResult {
  messageId: string;
  telegramMessageId: string;
}

const CAPTION_MAX = 1024;

function validateMedia(kind: string, mediaUrl: string, caption?: string | null) {
  if (!mediaUrl || !mediaUrl.trim()) throw new SendTelegramError('bad_request', 'media_url is required', 400);
  if (kind !== 'image' && kind !== 'document') throw new SendTelegramError('bad_request', 'Unsupported Telegram media kind', 400);
  if (caption && caption.length > CAPTION_MAX) throw new SendTelegramError('bad_request', `Caption exceeds ${CAPTION_MAX} chars`, 400);
  if (kind === 'image' && !/\.(png|jpg|jpeg|webp)(\?|$)/i.test(mediaUrl) && !mediaUrl.includes('chat-media')) {
    // allow chat-media URLs regardless of extension (signed URLs may have token)
  }
}

async function telegramSendViaUrl(botToken: string, method: string, payload: Record<string, unknown>): Promise<number> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
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
  return json.result.message_id;
}

export async function sendTelegramMedia(
  db: SupabaseClient,
  accountId: string,
  params: SendTelegramMediaParams,
): Promise<SendTelegramMediaResult> {
  const { conversationId, mediaUrl, mediaKind, filename, caption, replyToMessageId } = params;

  if (!conversationId) throw new SendTelegramError('bad_request', 'conversation_id is required', 400);
  validateMedia(mediaKind, mediaUrl, caption);

  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();
  if (convError || !conversation) throw new SendTelegramError('not_found', 'Conversation not found', 404);
  type TelegramContact = { id: string; telegram_user_id: number | null; telegram_chat_id: number | null };
  const contact = (conversation as unknown as { contact: TelegramContact | null }).contact;
  if (!contact?.telegram_user_id) throw new SendTelegramError('bad_request', 'Contact does not have a Telegram chat', 400);
  const chatId: number = contact.telegram_chat_id ?? contact.telegram_user_id;

  const { data: config, error: configError } = await db.from('telegram_config').select('*').eq('account_id', accountId).maybeSingle();
  if (configError || !config) throw new SendTelegramError('telegram_not_configured', 'Telegram not configured.', 400);
  let botToken: string;
  try {
    botToken = decrypt(config.bot_token_encrypted);
  } catch {
    throw new SendTelegramError('decrypt_failed', 'Failed to decrypt Telegram bot token.', 500);
  }
  if (isLegacyFormat(config.bot_token_encrypted)) {
    void db.from('telegram_config').update({ bot_token_encrypted: encrypt(botToken) }).eq('id', config.id).then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('[telegram-send-media] GCM upgrade failed:', error.message);
    });
  }

  let replyToTelegramId: number | undefined;
  let replyToInternalId: string | null = null;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('id, message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (parentError || !parent) throw new SendTelegramError('bad_request', 'reply_to_message_id not found in this conversation', 400);
    replyToInternalId = parent.id as string;
    if (parent.message_id && typeof parent.message_id === 'string' && parent.message_id.startsWith('tg_')) {
      const last = parent.message_id.split('_').pop();
      const num = parseInt(last ?? '', 10);
      if (!Number.isNaN(num)) replyToTelegramId = num;
    }
  }

  const payload: Record<string, unknown> = { chat_id: chatId };
  if (replyToTelegramId !== undefined) payload.reply_to_message_id = replyToTelegramId;
  let method: string;
  if (mediaKind === 'image') {
    method = 'sendPhoto';
    payload.photo = mediaUrl;
    if (caption) payload.caption = caption;
  } else {
    method = 'sendDocument';
    payload.document = mediaUrl;
    if (caption) payload.caption = caption;
  }

  let telegramMessageId: number;
  let providerMessageId: string;
  try {
    telegramMessageId = await telegramSendViaUrl(botToken, method, payload);
    providerMessageId = `tg_${chatId}_${telegramMessageId}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telegram-send-media] failed:', message);
    throw new SendTelegramError('telegram_error', `Telegram API error: ${message}`, 502);
  }

  const contentType = mediaKind === 'image' ? 'image' : 'document';
  const mediaType = mediaKind === 'image' ? 'image/jpeg' : 'application/octet-stream';
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: contentType,
      content_text: caption ?? filename ?? null,
      media_url: mediaUrl,
      media_type: mediaType,
      channel: 'telegram',
      message_id: providerMessageId,
      status: 'sent',
      reply_to_message_id: replyToInternalId,
    })
    .select()
    .single();
  if (msgError) {
    console.error('[telegram-send-media] insert failed:', msgError);
    throw new SendTelegramError('db_error', `Message sent to Telegram but failed to save to DB: ${msgError.message}`, 500);
  }

  await db.from('conversations').update({
    last_message_text: caption || (mediaKind === 'image' ? '[Image]' : filename || '[Document]'),
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId);

  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({ status: 'paused_by_agent', ended_at: new Date().toISOString(), end_reason: 'agent_replied' })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) console.error('[telegram-send-media] pause flow failed:', pauseErr.message);
  } catch (err) {
    console.error('[telegram-send-media] pause flow threw:', err instanceof Error ? err.message : err);
  }

  return { messageId: messageRecord.id, telegramMessageId: providerMessageId };
}
