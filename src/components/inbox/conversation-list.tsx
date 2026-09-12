"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  CONVERSATION_SELECT,
  type ChannelSummaryRow,
  type ConversationChannelSummary,
  type InboxChannelFilter,
  formatRpcError,
  matchesContactFilters,
  maxUpdatedAt,
  mergeConversationDelta,
  normalizeConversations,
  toChannelSummaryMap,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, MessageCircle, Send, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  /**
   * Increment to force a FULL refetch (mount, manual refresh). Unlike
   * resyncToken (delta path below), this re-reads the whole list —
   * the only path that also heals deletions.
   */
  resyncToken?: number;
  fullResyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

type InboxFilter = ConversationStatus | "all" | "unread";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  fullResyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<InboxChannelFilter>("all");
  const [channelSummaries, setChannelSummaries] = useState<
    Map<string, ConversationChannelSummary>
  >(new Map());
  // Account for the channel-summaries RPC. RLS still enforces
  // tenancy server-side; the account id is a filter, not a boundary.
  const { accountId } = useAuth();

  // T1.6 delta-resync bookkeeping. lastLoadAtRef is the updated_at
  // watermark (max seen); lastFullTokenRef records which full token
  // the watermark belongs to. conversationsRef mirrors the prop so
  // the async delta can merge against the latest list. localBump
  // re-fires this effect for the delta→full fallback without
  // involving the parent.
  const lastLoadAtRef = useRef<string | null>(null);
  const lastFullTokenRef = useRef(fullResyncToken);
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const [localBump, setResyncBump] = useState(0);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // T1.6 delta path: on auto-resync (reconnect/visibility) fetch
      // only conversations changed since the last successful load and
      // merge into the current list, instead of re-reading everything.
      // First mount, manual refresh (fullResyncToken), and any delta
      // failure fall back to the full read. 60s overlap absorbs
      // client/server clock skew; duplicates merge by id.
      // Channel summaries stay a full RPC re-read — already bounded
      // by conversation count (T1.1), so no delta needed there.
      const isDelta =
        lastLoadAtRef.current !== null && fullResyncToken === lastFullTokenRef.current;
      const since = lastLoadAtRef.current
        ? new Date(new Date(lastLoadAtRef.current).getTime() - 60_000).toISOString()
        : null;

      const conversationsQuery =
        isDelta && since
          ? supabase
              .from("conversations")
              .select(CONVERSATION_SELECT)
              .gte("updated_at", since)
              .order("last_message_at", { ascending: false })
          : supabase
              .from("conversations")
              .select(CONVERSATION_SELECT)
              .order("last_message_at", { ascending: false });

      // Channel badges come from a single aggregated RPC — one row per
      // conversation that has messages, so rows are bounded by the
      // conversation count and correct at any message volume. The old
      // full-table messages scan is gone (it was O(total messages) and
      // silently truncated past PostgREST's row cap).
      const [conversationsResult, summariesResult] = await Promise.all([
        conversationsQuery,
        accountId
          ? supabase.rpc("conversation_channel_summaries", {
              p_account_id: accountId,
            })
          : Promise.resolve({
              data: [] as ChannelSummaryRow[],
              error: null,
            }),
      ]);

      if (cancelled) return;

      if (conversationsResult.error) {
        // Delta failure must not blank the list: fall back to a full
        // read on the next tick rather than committing an error state.
        if (isDelta) {
          lastLoadAtRef.current = null;
          setResyncBump((n) => n + 1);
          return;
        }
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: conversationsResult.error.message,
          details: conversationsResult.error.details,
          hint: conversationsResult.error.hint,
          code: conversationsResult.error.code,
        });
        setLoading(false);
        return;
      }

      if (summariesResult.error) {
        // PostgREST errors carry non-enumerable props (a bare log
        // renders as `{}`), so extract fields explicitly. A
        // missing-RPC 404 here means migration 064 isn't applied to
        // the database — the badges degrade to empty, the list
        // itself still renders.
        console.error(
          "Failed to fetch conversation channels:",
          formatRpcError(summariesResult.error),
        );
      }

      const nextSummaries = toChannelSummaryMap(
        (summariesResult.data ?? []) as ChannelSummaryRow[],
      );

      setChannelSummaries(nextSummaries);
      const loaded = normalizeConversations(conversationsResult.data ?? []);
      if (isDelta) {
        onConversationsLoadedRef.current(
          mergeConversationDelta(conversationsRef.current, loaded),
        );
      } else {
        onConversationsLoadedRef.current(loaded);
        lastFullTokenRef.current = fullResyncToken;
      }
      // Watermark: max updated_at seen minus the 60s overlap is
      // recomputed below from the committed rows; empty results keep
      // the previous watermark so the next delta still overlaps.
      const watermark = maxUpdatedAt(
        isDelta ? conversationsRef.current : loaded,
      );
      if (watermark) lastLoadAtRef.current = watermark;
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
    // `accountId` is included so the channel-summaries RPC runs once
    // auth resolves (before that it resolves to an empty map).
    // `fullResyncToken` forces the full read (manual refresh).
    // `localBump` re-fires after a delta failure so the fallback
    // full read runs without parent involvement.
  }, [resyncToken, fullResyncToken, accountId, localBump]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (channelFilter !== "all") {
      result = result.filter((conversation) => {
        const summary = channelSummaries.get(conversation.id);
        return summary != null && summary.channels.includes(channelFilter);
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const telegramUsername = c.contact?.telegram_username?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return (
          name.includes(q) ||
          phone.includes(q) ||
          telegramUsername.includes(q) ||
          lastMsg.includes(q)
        );
      });
    }

    return result;
  }, [
    channelFilter,
    channelSummaries,
    conversations,
    filter,
    search,
    selectedTagIds,
    selectedCompany,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              {channelFilter === "all"
                ? t("channelAll")
                : t(`channel${channelFilter === "whatsapp" ? "WhatsApp" : "Telegram"}`)}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {(["all", "whatsapp", "telegram"] as const).map((channel) => {
                const label =
                  channel === "all"
                    ? t("channelAll")
                    : t(`channel${channel === "whatsapp" ? "WhatsApp" : "Telegram"}`);
                return (
                  <DropdownMenuItem
                    key={channel}
                    onClick={() => setChannelFilter(channel)}
                    className={cn(
                      "text-sm",
                      channelFilter === channel
                        ? "text-primary"
                        : "text-popover-foreground",
                    )}
                  >
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {channelFilter === "all"
                ? t("noConversations")
                : t("noChannelConversations", {
                    channel: t(
                      `channel${channelFilter === "whatsapp" ? "WhatsApp" : "Telegram"}`,
                    ),
                  })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                channelSummary={channelSummaries.get(conv.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  channelSummary?: ConversationChannelSummary;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  channelSummary,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName =
    contact?.name ||
    contact?.phone ||
    contact?.telegram_username ||
    t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-border/40 hover:bg-muted/40",
        isActive ? "border-l-2 border-l-primary bg-primary/5" : "border-l-2 border-l-transparent"
      )}
    >
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/80 text-xs font-semibold text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <ChannelIndicator
              summary={channelSummary}
              t={t}
            />
            <p className="truncate text-[11px] text-muted-foreground">
              {conversation.last_message_text || t("noMessagesYet")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground tabular-nums">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

function ChannelIndicator({
  summary,
  t,
}: {
  summary?: ConversationChannelSummary;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!summary || summary.channels.length === 0) return null;

  const label = summary.channels
    .map((channel) =>
      t(`channel${channel === "whatsapp" ? "WhatsApp" : "Telegram"}`),
    )
    .join(" + ");

  return (
    <span
      className="inline-flex shrink-0 items-center text-muted-foreground"
      aria-label={label}
      title={label}
    >
      {summary.channels.map((channel) =>
        channel === "whatsapp" ? (
          <MessageCircle key={channel} className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Send key={channel} className="h-3 w-3" aria-hidden="true" />
        ),
      )}
    </span>
  );
}
