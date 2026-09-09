// Provider-specific Telegram attachment sender — images + documents via URL.
// Keeps WhatsApp path untouched (sendMessageToConversation).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { decrypt, isLegacyFormat, encrypt } from '@/lib/whatsapp/encryption';
import { SendTelegramError } from './send';
import type { TelegramInlineMarkup } from './keyboard';
import { validateTelegramInlineMarkup, toTelegramReplyMarkup } from './keyboard';

export interface SendTelegramMediaParams {
  conversationId: string;
  mediaUrl: string; // public chat-media URL
  mediaKind: 'image' | 'document' | 'video' | 'audio' | 'voice';
  filename?: string | null;
  caption?: string | null;
  replyToMessageId?: string | null;
  inlineKeyboard?: TelegramInlineMarkup | null;
}

export interface SendTelegramMediaResult {
  messageId: string;
  telegramMessageId: string;
}

const CAPTION_MAX = 1024;

function validateMedia(kind: string, mediaUrl: string, caption?: string | null) {
  if (!mediaUrl || !mediaUrl.trim()) throw new SendTelegramError('bad_request', 'media_url is required', 400);
  if (kind !== 'image' && kind !== 'document' && kind !== 'video' && kind !== 'audio' && kind !== 'voice')
    throw new SendTelegramError('bad_request', 'Unsupported Telegram media kind', 400);
  if (caption && caption.length > CAPTION_MAX) throw new SendTelegramError('bad_request', `Caption exceeds ${CAPTION_MAX} chars`, 400);
  // Telegram official: sendAudio → .MP3 or .M4A, sendVoice → .OGG+OPUS or .MP3/.M4A (via public URL, URL ≤20 MB per #sending-files)
  // Validate before Telegram round-trip for UX; remain permissive for edge MIME aliases.
  if (kind === 'audio') {
    const lower = (mediaUrl + (caption ?? '')).toLowerCase();
    // rely on mediaUrl extension or fallback mime check is best-effort; enforce strict only on explicit filename when present
    void lower; // mediaUrl check is permissive — strictness handled via filename/media_type before persist
  }
  if (kind === 'voice') {
    // Telegram sendVoice: caption is allowed (0-1024) per #sendvoice; mime must be OGG/OPUS or MP3/M4A
    void caption;
  }
  if (kind === 'image' && !/\.(png|jpg|jpeg|webp)(\?|$)/i.test(mediaUrl) && !mediaUrl.includes('chat-media')) {
    // allow chat-media URLs regardless of extension (signed URLs may have token)
  }
}

function validateAudioMimeForKind(kind: string, mediaUrl: string, filename: string | null | undefined) {
  const src = (filename ?? mediaUrl).toLowerCase();
  const ext = src.split('?')[0].split('.').pop() ?? '';
  if (kind === 'audio') {
    // Official: .MP3 or .M4A — Telegram will 400 otherwise; we reject early
    if (ext !== 'mp3' && ext !== 'm4a' && ext !== 'mpga' && !src.includes('audio/mpeg') && !src.includes('audio/mp4')) {
      // best-effort: require mp3/m4a extension or audio mime hint; fallback to allow if chat-media (mime not in URL)
      if (src.includes('chat-media')) return; // MIME will be derived from file.type, accept
      throw new SendTelegramError('bad_request', 'Telegram audio must be MP3 or M4A', 400);
    }
  }
  if (kind === 'voice') {
    // Official: .OGG+OPUS or .MP3 or .M4A (voice) — URL ≤1 MB OGG per #sending-files, but bucket 16 MB safety keeps us under
    if (ext !== 'ogg' && ext !== 'oga' && ext !== 'mp3' && ext !== 'm4a' && ext !== 'mpga') {
      if (src.includes('chat-media')) return;
      throw new SendTelegramError('bad_request', 'Telegram voice must be OGG (OPUS), MP3, or M4A', 400);
    }
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
  const { conversationId, mediaUrl, mediaKind, filename, caption, replyToMessageId, inlineKeyboard } = params;

  if (!conversationId) throw new SendTelegramError('bad_request', 'conversation_id is required', 400);
  validateMedia(mediaKind, mediaUrl, caption);
  validateAudioMimeForKind(mediaKind, mediaUrl, filename);
  if (inlineKeyboard) {
    const v = validateTelegramInlineMarkup(inlineKeyboard);
    if (!v.ok) throw new SendTelegramError('bad_request', v.error, 400);
  }

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
  const replyMarkup = inlineKeyboard ? toTelegramReplyMarkup(inlineKeyboard) : undefined;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  let method: string;
  if (mediaKind === 'image') {
    method = 'sendPhoto';
    payload.photo = mediaUrl;
    if (caption) payload.caption = caption;
  } else if (mediaKind === 'video') {
    method = 'sendVideo';
    payload.video = mediaUrl;
    if (caption) payload.caption = caption;
  } else if (mediaKind === 'audio') {
    method = 'sendAudio';
    payload.audio = mediaUrl;
    if (caption) payload.caption = caption;
  } else if (mediaKind === 'voice') {
    method = 'sendVoice';
    payload.voice = mediaUrl;
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

  const hasKeyboard = !!inlineKeyboard;
  const contentType = hasKeyboard
    ? 'interactive'
    : mediaKind === 'image'
      ? 'image'
      : mediaKind === 'video'
        ? 'video'
        : mediaKind === 'audio' || mediaKind === 'voice'
          ? 'audio'
          : 'document';
  const mediaType =
    mediaKind === 'image'
      ? 'image/jpeg'
      : mediaKind === 'video'
        ? 'video/mp4'
        : mediaKind === 'audio'
          ? 'audio/mpeg'
          : mediaKind === 'voice'
            ? 'audio/ogg'
            : 'application/octet-stream';
  const mediaInsert: Database['public']['Tables']['messages']['Insert'] = {
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
    ...(hasKeyboard
      ? { interactive_payload: { kind: 'telegram_inline', markup: inlineKeyboard } as unknown as never }
      : {}),
  };
  const { data: messageRecord, error: msgError } = await db.from('messages').insert(mediaInsert).select().single();
  if (msgError) {
    console.error('[telegram-send-media] insert failed:', msgError);
    throw new SendTelegramError('db_error', `Message sent to Telegram but failed to save to DB: ${msgError.message}`, 500);
  }

  const fallbackLabel =
    mediaKind === 'image' ? '[Image]' : mediaKind === 'video' ? '[Video]' : mediaKind === 'audio' ? '[Audio]' : mediaKind === 'voice' ? '[Voice]' : filename || '[Document]';
  await db.from('conversations').update({
    last_message_text: hasKeyboard ? '[Keyboard]' : caption || fallbackLabel,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId);

  // NOTE: flow_runs pause-on-agent was retired with the old flow engine
  // (Phase 9). Manual sends no longer touch automation state.

  return { messageId: messageRecord.id, telegramMessageId: providerMessageId };
}
