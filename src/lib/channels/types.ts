/**
 * Channel boundary (Phase 1 inbound-only heritage, now multi-channel).
 *
 * Approved constraints (unchanged):
 * - conversations remain unified (single thread per contact); messages carry channel
 * - no generic `channels` table, no ChannelSender, no Conversation.channel
 * - NormalizedInbound is provider → CRM boundary
 * - each new plug adds its own config table + identity columns
 */
export type Channel = 'whatsapp' | 'telegram' | 'email'

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
  /** For TG: stable identity fields + media file name (document) */
  telegramUserId?: number
  telegramChatId?: number
  telegramUsername?: string | null
  telegramFileName?: string | null
  /** Sender phone for WA (digits), display name */
  senderPhone?: string | null
  senderName?: string | null
  /** For email: sender address, subject, provider message id */
  senderEmail?: string | null
  emailSubject?: string | null
  emailMessageId?: string | null
  /** In-Reply-To / References threading headers, if present */
  emailInReplyTo?: string | null
  emailReferences?: string[] | null
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
    photo?: Array<{ file_id: string; file_size?: number }>
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    video?: { file_id: string; mime_type?: string; file_size?: number }
    audio?: { file_id: string; mime_type?: string; file_size?: number }
    voice?: { file_id: string; mime_type?: string; file_size?: number }
    sticker?: { file_id: string; file_size?: number }
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
