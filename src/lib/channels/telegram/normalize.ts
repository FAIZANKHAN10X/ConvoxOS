import type { NormalizedInbound, TelegramUpdate } from '@/lib/channels/types'

function displayNameFrom(from?: { first_name?: string; last_name?: string; username?: string }): string {
  if (!from) return ''
  const parts = [from.first_name, from.last_name].filter(Boolean).join(' ').trim()
  if (parts) return parts
  return from.username || ''
}

/**
 * Telegram normalizer — Update → NormalizedInbound.
 *
 * Pure mapping, no DB, no decrypt of bot_token. Only uses fields present
 * in Telegram Bot API Update.
 *
 * Phase 1 inbound-only: text, caption (photo/document), location,
 * callback_query (→ interactive_reply). Media file_id is not downloaded
 * in Phase 1; mediaUrl stays null (text-only mirroring).
 */
export function normalizeTelegramUpdate(opts: {
  update: TelegramUpdate
  accountId: string
  configOwnerUserId: string
}): NormalizedInbound | null {
  const { update, accountId, configOwnerUserId } = opts

  // callback_query takes precedence — interactive_reply
  if (update.callback_query) {
    const cq = update.callback_query
    const from = cq.from
    const chatId = cq.message?.chat.id ?? from.id
    const data = cq.data ?? ''
    const providerMessageId = `tg_cb_${cq.id}`
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'interactive_reply',
      text: data || null,
      replyId: data || null,
      replyTitle: data || null,
      telegramUserId: from.id,
      telegramChatId: chatId,
      telegramUsername: from.username ?? null,
      senderName: displayNameFrom(from),
      raw: update,
    }
  }

  const msg = update.message
  if (!msg) return null

  const from = msg.from
  const chat = msg.chat
  const telegramUserId = from?.id
  const telegramChatId = chat?.id
  const telegramUsername = from?.username ?? null
  const senderName = displayNameFrom(from)
  // Telegram message_id is per-chat int, not globally unique — prefix for providerMessageId
  const providerMessageId = `tg_${chat.id}_${msg.message_id}`

  // text
  if (msg.text !== undefined) {
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'text',
      text: msg.text,
      telegramUserId,
      telegramChatId,
      telegramUsername,
      senderName,
      raw: update,
    }
  }

  // caption-bearing media: treat caption as text, kind text for CRM pipeline
  if (msg.caption !== undefined) {
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'text',
      text: msg.caption,
      telegramUserId,
      telegramChatId,
      telegramUsername,
      senderName,
      raw: update,
    }
  }

  // location
  if (msg.location) {
    const loc = msg.location
    const text = `${loc.latitude},${loc.longitude}`
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'location',
      text,
      telegramUserId,
      telegramChatId,
      telegramUsername,
      senderName,
      raw: update,
    }
  }

  // photo/document/video/audio/voice/sticker without caption — still text with placeholder
  if (msg.photo || msg.document || msg.video || msg.audio || msg.voice || msg.sticker) {
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'media',
      text: '[media]',
      telegramUserId,
      telegramChatId,
      telegramUsername,
      senderName,
      raw: update,
    }
  }

  // unsupported edited_message etc. -> null (skip)
  return null
}
