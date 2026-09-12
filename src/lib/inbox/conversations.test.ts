import { describe, it, expect } from "vitest";
import {
  getAvailableContactChannels,
  matchesChannelFilter,
  matchesContactFilters,
  normalizeConversation,
  summarizeConversationChannels,
} from "./conversations";
import type { ConversationChannelSummary } from "./conversations";
import type { Conversation, Message } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

function makeMessage(
  channel: Message["channel"],
  created_at: string,
): Pick<Message, "channel" | "created_at"> {
  return { channel, created_at };
}

const contact = (overrides: Partial<NonNullable<Conversation["contact"]>> = {}) => ({
  id: "ct1",
  user_id: "u1",
  account_id: "a1",
  phone: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("summarizeConversationChannels", () => {
  it("summarizes a WhatsApp-only conversation", () => {
    expect(
      summarizeConversationChannels([
        makeMessage("whatsapp", "2026-01-01T00:00:00Z"),
      ]),
    ).toEqual({ channels: ["whatsapp"], latestChannel: "whatsapp" });
  });

  it("summarizes a Telegram-only conversation", () => {
    expect(
      summarizeConversationChannels([
        makeMessage("telegram", "2026-01-01T00:00:00Z"),
      ]),
    ).toEqual({ channels: ["telegram"], latestChannel: "telegram" });
  });

  it("keeps both channels for mixed history and tracks the latest known channel", () => {
    expect(
      summarizeConversationChannels([
        makeMessage("whatsapp", "2026-01-01T00:00:00Z"),
        makeMessage("telegram", "2026-01-02T00:00:00Z"),
      ]),
    ).toEqual({
      channels: ["whatsapp", "telegram"],
      latestChannel: "telegram",
    });
  });

  it("ignores messages without channel provenance", () => {
    expect(
      summarizeConversationChannels([
        makeMessage(undefined, "2026-01-01T00:00:00Z"),
      ]),
    ).toEqual({ channels: [], latestChannel: null });
  });
});

describe("matchesChannelFilter", () => {
  const mixed: ConversationChannelSummary = {
    channels: ["whatsapp", "telegram"],
    latestChannel: "telegram" as const,
  };

  it("matches all channels and both channel views for mixed history", () => {
    expect(matchesChannelFilter(mixed, "all")).toBe(true);
    expect(matchesChannelFilter(mixed, "whatsapp")).toBe(true);
    expect(matchesChannelFilter(mixed, "telegram")).toBe(true);
  });

  it("does not match a channel absent from the conversation", () => {
    expect(
      matchesChannelFilter(
        { channels: ["whatsapp"], latestChannel: "whatsapp" },
        "telegram",
      ),
    ).toBe(false);
  });
});

describe("getAvailableContactChannels", () => {
  it("handles WhatsApp-only, Telegram-only, both, and neither", () => {
    expect(getAvailableContactChannels(contact({ phone: "+1" }))).toEqual([
      "whatsapp",
    ]);
    expect(
      getAvailableContactChannels(contact({ telegram_user_id: 123 })),
    ).toEqual(["telegram"]);
    expect(
      getAvailableContactChannels(
        contact({ phone: "+1", telegram_user_id: 123 }),
      ),
    ).toEqual(["whatsapp", "telegram"]);
    expect(getAvailableContactChannels(contact())).toEqual([]);
    expect(getAvailableContactChannels(null)).toEqual([]);
  });
});

describe("toChannelSummaryMap", () => {
  it("folds RPC rows by conversation id with null normalization", async () => {
    const { toChannelSummaryMap } = await import("./conversations");
    const map = toChannelSummaryMap([
      {
        conversation_id: "c1",
        channels: ["whatsapp", "telegram"],
        latest_channel: "telegram",
      },
      { conversation_id: "c2", channels: null, latest_channel: null },
    ]);
    expect(map.get("c1")).toEqual({
      channels: ["whatsapp", "telegram"],
      latestChannel: "telegram",
    });
    expect(map.get("c2")).toEqual({ channels: [], latestChannel: null });
  });

  it("handles conversation counts past the old row cap", async () => {
    const { toChannelSummaryMap } = await import("./conversations");
    // The old full-scan silently truncated past ~1000 message rows;
    // the RPC returns one row per conversation regardless of volume.
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      conversation_id: `c${i}`,
      channels: ["whatsapp"] as ("whatsapp" | "telegram")[],
      latest_channel: "whatsapp" as const,
    }));
    const map = toChannelSummaryMap(rows);
    expect(map.size).toBe(2500);
    expect(map.get("c2499")).toEqual({
      channels: ["whatsapp"],
      latestChannel: "whatsapp",
    });
  });
});

describe("mergeConversationDelta + maxUpdatedAt (T1.6)", () => {
  it("replaces existing rows, prepends new ones, never duplicates", async () => {
    const { mergeConversationDelta, maxUpdatedAt } = await import("./conversations");
    const prev = [
      { id: "a", updated_at: "2026-09-01T00:00:00Z" },
      { id: "b", updated_at: "2026-09-01T00:00:00Z" },
    ] as never[];
    const delta = [
      { id: "b", updated_at: "2026-09-02T00:00:00Z" },
      { id: "c", updated_at: "2026-09-02T00:00:00Z" },
    ] as never[];
    const merged = mergeConversationDelta(prev as never, delta as never) as { id: string; updated_at: string }[];
    expect(merged.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(merged.find((c) => c.id === "b")?.updated_at).toBe("2026-09-02T00:00:00Z");
    // Empty delta returns the same reference (no re-render churn)
    expect(mergeConversationDelta(prev as never, [])).toBe(prev);
    expect(maxUpdatedAt(merged)).toBe("2026-09-02T00:00:00Z");
    expect(maxUpdatedAt([])).toBeNull();
    expect(maxUpdatedAt([{ id: "x" }] as never)).toBeNull();
  });
});
