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
 * Text, caption, location, callback_query are direct. Media (photo,
 * document, video, audio, voice, sticker) emits kind:'media' with
 * mediaUrl=file_id and mediaType derived from the provider — the webhook
 * then mirrors the file into chat-media under telegram/ prefix.
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

  // text (no media)
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

  // --- Media detection (photo is largest last, document/video/etc have single file_id)
  // Extract file_id + mime/fileName for later mirroring. Caption is preserved as text.
  let mediaFileId: string | null = null
  let mediaMime: string | null = null
  let mediaFileName: string | null = null
  if (msg.photo && msg.photo.length > 0) {
    mediaFileId = msg.photo[msg.photo.length - 1].file_id
    mediaMime = 'image/jpeg'
  } else if (msg.document) {
    mediaFileId = msg.document.file_id
    mediaMime = msg.document.mime_type ?? null
    mediaFileName = msg.document.file_name ?? null
  } else if (msg.video) {
    mediaFileId = msg.video.file_id
    mediaMime = msg.video.mime_type ?? 'video/mp4'
  } else if (msg.audio) {
    mediaFileId = msg.audio.file_id
    mediaMime = msg.audio.mime_type ?? 'audio/mpeg'
  } else if (msg.voice) {
    mediaFileId = msg.voice.file_id
    mediaMime = msg.voice.mime_type ?? 'audio/ogg'
  } else if (msg.sticker) {
    mediaFileId = msg.sticker.file_id
    mediaMime = 'image/webp'
  }

  if (mediaFileId) {
    const caption = msg.caption ?? null
    // Preserve original file name for document so mirror keeps the basename (invoice.pdf)
    const fileNameForRaw: string | null = mediaFileName ?? null
    return {
      channel: 'telegram',
      accountId,
      configOwnerUserId,
      providerMessageId,
      kind: 'media',
      text: caption && caption.trim() ? caption : '[media]',
      mediaUrl: mediaFileId,
      mediaType: mediaMime,
      telegramUserId,
      telegramChatId,
      telegramUsername,
      telegramFileName: fileNameForRaw,
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

  // unsupported edited_message etc. -> null (skip)
  return null
}
