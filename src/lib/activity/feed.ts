import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityType =
  | 'message_inbound'
  | 'message_outbound'
  | 'tag_added'
  | 'contact_updated'
  | 'task_created'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'note_added'
  | 'sequence_enrolled'
  | 'sequence_completed'
  | 'sequence_cancelled'

export interface ActivityItem {
  id: string
  type: ActivityType
  title: string
  description?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ActivityFeedOptions {
  contactId: string
  accountId: string
  limit?: number
  cursor?: string | null
  filter?: ActivityType | 'all'
}

// Opaque keyset cursor: base64url(created_at|key). Self-contained
// (not shared with the v1 pagination helper) so the feed contract
// stays independent of the public API module. Malformed cursors
// restart from the first page — never run an attacker-shaped value.
function encodeFeedCursor(createdAt: string, key: string): string {
  return Buffer.from(`${createdAt}|${key}`, 'utf8').toString('base64url')
}

function decodeFeedCursor(
  value: string | null | undefined
): { createdAt: string; key: string } | null {
  if (!value) return null
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const sep = decoded.indexOf('|')
    if (sep === -1) return null
    const createdAt = decoded.slice(0, sep)
    const key = decoded.slice(sep + 1)
    if (!createdAt || !key) return null
    if (Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, key }
  } catch {
    return null
  }
}

interface FeedRow {
  item_id: string
  item_type: string
  created_at: string
  title: string
  description: string | null
  metadata: Record<string, unknown> | null
  key: string
}

export async function getContactActivityFeed(
  supabase: SupabaseClient,
  opts: ActivityFeedOptions
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
  const cursor = decodeFeedCursor(opts.cursor ?? null)

  // NOTE: automation_logs / flow_runs reads were retired with the old
  // automation engine (Phase 9). The feed covers CRM activity only.
  // Single RPC (migration 066): UNION ALL across sources with
  // (created_at, key) keyset pagination. Over-fetches one row to
  // detect the next page — no JS merge, sort, or slice.
  const { data, error } = await supabase.rpc('get_contact_activity', {
    p_account_id: opts.accountId,
    p_contact_id: opts.contactId,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_key: cursor?.key ?? null,
    p_filter: opts.filter && opts.filter !== 'all' ? opts.filter : 'all',
  })
  if (error) throw new Error(`activity feed: ${error.message}`)

  const rows = ((data ?? []) as FeedRow[]).slice(0, limit + 1)
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const items: ActivityItem[] = page.map((r) => ({
    id: r.item_id,
    type: r.item_type as ActivityType,
    title: r.title,
    description: r.description ?? undefined,
    timestamp:
      typeof r.created_at === 'string'
        ? r.created_at
        : new Date(r.created_at).toISOString(),
    metadata: r.metadata ?? undefined,
  }))

  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeFeedCursor(
          typeof last.created_at === 'string'
            ? last.created_at
            : new Date(last.created_at).toISOString(),
          last.key
        )
      : null

  return { items, nextCursor }
}
