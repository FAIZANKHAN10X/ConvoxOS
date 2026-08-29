import type { Channel, Conversation, Contact, Message, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export type InboxChannelFilter = "all" | Channel;

export interface ConversationChannelSummary {
  channels: Channel[];
  latestChannel: Channel | null;
}

const CHANNEL_ORDER: Channel[] = ["whatsapp", "telegram"];

/**
 * Derive the channels represented by a thread without adding channel state to
 * the conversation itself. Messages written before channel provenance was
 * available are intentionally ignored until their provider is known.
 */
export function summarizeConversationChannels(
  messages: Pick<Message, "channel" | "created_at">[],
): ConversationChannelSummary {
  const channels = CHANNEL_ORDER.filter((channel) =>
    messages.some((message) => message.channel === channel),
  );
  const latestChannel = [...messages]
    .reverse()
    .find((message) => message.channel != null)?.channel ?? null;

  return { channels, latestChannel };
}

/**
 * Channel filters match any message in the unified conversation. This keeps a
 * mixed WhatsApp/Telegram thread visible in both channel views.
 */
export function matchesChannelFilter(
  summary: ConversationChannelSummary,
  filter: InboxChannelFilter,
): boolean {
  return filter === "all" || summary.channels.includes(filter);
}

/** Return the outbound identities available for a contact. */
export function getAvailableContactChannels(contact: Contact | null): Channel[] {
  if (!contact) return [];

  return CHANNEL_ORDER.filter((channel) =>
    channel === "whatsapp"
      ? Boolean(contact.phone)
      : Boolean(contact.telegram_user_id),
  );
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
