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
};

/**
 * Merge a delta fetch into the current list (T1.6 resync path).
 * Existing rows are replaced wholesale (delta rows carry the full
 * contact join, unlike realtime patches); genuinely new rows are
 * prepended, mirroring the realtime INSERT handler. Order otherwise
 * preserved — the list arrives last_message_at DESC and realtime
 * already patches in place, so delta merge behaves identically.
 */
export function mergeConversationDelta(
  prev: Conversation[],
  delta: Conversation[],
): Conversation[] {
  if (delta.length === 0) return prev;
  const byId = new Map(delta.map((c) => [c.id, c]));
  const merged = prev.map((c) => byId.get(c.id) ?? c);
  const prevIds = new Set(prev.map((c) => c.id));
  const fresh = delta.filter((c) => !prevIds.has(c.id));
  return [...fresh, ...merged];
}

/**
 * Max updated_at across rows — the T1.6 delta watermark. Null when
 * there is nothing to watermark (empty list or missing stamps).
 */
export function maxUpdatedAt(rows: { updated_at?: string | null }[]): string | null {
  let max: string | null = null;
  for (const row of rows) {
    if (row.updated_at && (max === null || row.updated_at > max)) {
      max = row.updated_at;
    }
  }
  return max;
}

/** Row shape returned by the `conversation_channel_summaries` RPC
 * (migration 064): one row per conversation that has messages.
 */
export interface ChannelSummaryRow {
  conversation_id: string;
  channels: Channel[] | null;
  latest_channel: Channel | null;
}

/**
 * Fold RPC rows into the summary map the inbox list renders from.
 * Pure — the RPC already aggregated per conversation, so this is a
 * straight key-by-id with null normalization (conversations whose
 * messages all predate channel provenance get an empty set).
 */
export function toChannelSummaryMap(
  rows: ChannelSummaryRow[],
): Map<string, ConversationChannelSummary> {
  const map = new Map<string, ConversationChannelSummary>();
  for (const row of rows) {
    map.set(row.conversation_id, {
      channels: row.channels ?? [],
      latestChannel: row.latest_channel,
    });
  }
  return map;
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
