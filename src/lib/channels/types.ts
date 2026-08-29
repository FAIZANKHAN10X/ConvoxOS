/**
 * Minimal channel boundary for Phase 1 inbound-only.
 *
 * Approved constraints:
 * - conversations remain unified (single thread per contact); messages carry channel
 * - no generic `channels` table, no ChannelSender, no Conversation.channel
 * - Telegram inbound-only, no outbound/broadcast
 * - NormalizedInbound is provider → CRM boundary
 */

export type Channel = 'whatsapp' | 'telegram'

export type NormalizedKind = 'text' | 'interactive_reply' | 'media' | 'location' | 'reaction'

export interface NormalizedInbound {
  /** Provider that delivered this inbound */
  channel: Channel
  /** Tenancy — resolved from config PK lookup (WA: phone_number_id, TG: configId) */
  accountId: string
  /** Audit sender-of-record — config owner user_id */
  configOwnerUserId: string
  /** Existing contact id after dedupe, or new */
  contactId?: string
  conversationId?: string
  /** Stable provider message id (wamid or telegram message_id string) */
  providerMessageId: string
  kind: NormalizedKind
  /** Body/caption for text/media */
  text?: string | null
  /** For interactive_reply: stable id (WA button_reply.id / TG callback_data) */
  replyId?: string | null
  replyTitle?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
  /** Raw provider payload for debugging */
  raw?: unknown
  /** Whether this is first customer message in this conversation */
  isFirstInboundMessage?: boolean
  /** For TG: stable identity fields */
  telegramUserId?: number
  telegramChatId?: number
  telegramUsername?: string | null
  /** Sender phone for WA (digits), display name */
  senderPhone?: string | null
  senderName?: string | null
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string; last_name?: string }
    chat: { id: number; username?: string; title?: string; type: string }
    date: number
    text?: string
    caption?: string
    photo?: Array<{ file_id: string }>
    document?: { file_id: string; file_name?: string; mime_type?: string }
    video?: { file_id: string; mime_type?: string }
    audio?: { file_id: string }
    voice?: { file_id: string }
    sticker?: { file_id: string }
    location?: { latitude: number; longitude: number }
    reply_to_message?: { message_id: number }
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string; first_name?: string }
    message?: { message_id: number; chat: { id: number } }
    data?: string
  }
  edited_message?: unknown
}
