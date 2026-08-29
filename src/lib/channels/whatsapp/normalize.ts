import type { NormalizedInbound } from '@/lib/channels/types'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/**
 * WhatsApp normalizer — WhatsAppMessage + contact envelope → NormalizedInbound stub.
 *
 * This is the provider-specific side. It does NOT touch DB.
 * It mirrors the existing `normalizePhone` + `parseMessageContent` intent
 * without duplicating media-mirror logic (which stays in webhook until shared).
 *
 * Phase 1 inbound WA still uses webhook's parseMessageContent for media/template
 * handling; this helper only normalizes identity + kind for the shared path.
 * Kept for symmetry with telegram normalize and for future pure-data tests.
 */

interface WhatsAppMessageStub {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  button?: { text?: string; payload?: string }
  reaction?: { message_id: string; emoji: string }
}

export function normalizeWhatsappStub(opts: {
  message: WhatsAppMessageStub
  contactWaId: string
  contactName: string
  accountId: string
  configOwnerUserId: string
}): NormalizedInbound {
  const { message, contactWaId, contactName, accountId, configOwnerUserId } = opts
  const senderPhone = normalizePhone(message.from)
  const providerMessageId = message.id
  const isReaction = message.type === 'reaction'
  const interactiveId =
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.button?.payload ??
    message.button?.text ??
    null

  let kind: NormalizedInbound['kind'] = 'text'
  let text: string | null = message.text?.body ?? null
  let replyId: string | null = null

  if (isReaction) {
    kind = 'reaction'
    text = message.reaction?.emoji ?? null
  } else if (interactiveId) {
    kind = 'interactive_reply'
    replyId = interactiveId
    text =
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      message.button?.text ??
      interactiveId
  } else if (message.type === 'location') {
    kind = 'location'
  } else if (['image', 'video', 'document', 'audio', 'sticker'].includes(message.type)) {
    kind = 'media'
  }

  return {
    channel: 'whatsapp',
    accountId,
    configOwnerUserId,
    providerMessageId,
    kind,
    text,
    replyId,
    replyTitle: text,
    senderPhone,
    senderName: contactName || contactWaId,
    raw: message,
  }
}
