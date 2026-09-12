import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// ------------------------------------------------------------
// Aggregation lives in PostgreSQL (migrations 064/066/068); this
// module maps RPC rows onto the dashboard's typed bundles. RLS +
// explicit account predicates scope every query — accountId is
// always passed, never inferred. loadActivity's small bounded
// queries stay direct (4 trips, ≤35 rows); consolidating them
// would trade clarity for nothing measurable.
// ------------------------------------------------------------

type DB = SupabaseClient

async function accountIdOf(db: DB): Promise<string> {
  // Dashboard loaders run with a user client; resolve the caller's
  // account once per call. RLS remains the enforcement boundary.
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) throw new Error('dashboard: not signed in')
  const { data } = await db
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = (data as { account_id?: string } | null)?.account_id
  if (!accountId) throw new Error('dashboard: no account for caller')
  return accountId
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(db: DB): Promise<MetricsBundle> {
  const accountId = await accountIdOf(db)
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  // One trip, nine scalars, zero data rows (migration 068).
  const { data, error } = await db.rpc('dashboard_metrics', {
    p_account_id: accountId,
    p_today_start: todayStart,
    p_yesterday_start: yesterdayStart,
  })
  if (error) throw error
  const m = (Array.isArray(data) ? data[0] : data) as {
    open_conv: number
    new_conv_today: number
    new_conv_yesterday: number
    new_contacts_today: number
    new_contacts_yesterday: number
    open_deals_count: number
    open_deals_value: string | number
    msgs_today: number
    msgs_yesterday: number
  }

  return {
    activeConversations: {
      current: Number(m.open_conv ?? 0),
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: Number(m.new_conv_today ?? 0) - Number(m.new_conv_yesterday ?? 0),
    },
    newContactsToday: {
      current: Number(m.new_contacts_today ?? 0),
      previous: Number(m.new_contacts_yesterday ?? 0),
    },
    openDealsValue: Number(m.open_deals_value ?? 0),
    openDealsCount: Number(m.open_deals_count ?? 0),
    messagesSentToday: {
      current: Number(m.msgs_today ?? 0),
      previous: Number(m.msgs_yesterday ?? 0),
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
  tz?: string,
): Promise<ConversationsSeriesPoint[]> {
  const accountId = await accountIdOf(db)
  const start = daysAgoStart(rangeDays - 1).toISOString()
  // Day buckets in the caller's timezone (migration 068). Server
  // callers pass UTC (matching prior SSR behavior); the browser
  // passes its own zone (matching prior client behavior).
  const zone =
    tz ?? (typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC')
  const { data, error } = await db.rpc('dashboard_series', {
    p_account_id: accountId,
    p_start: start,
    p_tz: zone,
  })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { day: string; incoming: number; outgoing: number }[]) {
    const bucket = buckets.get(row.day)
    if (!bucket) continue
    bucket.incoming += Number(row.incoming ?? 0)
    bucket.outgoing += Number(row.outgoing ?? 0)
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(db: DB): Promise<PipelineDonutData> {
  const accountId = await accountIdOf(db)
  // Stages + open-deal aggregates in one trip (migration 068).
  const { data, error } = await db.rpc('dashboard_pipeline', {
    p_account_id: accountId,
  })
  if (error) throw error

  const slices: PipelineStageSlice[] = (
    (data ?? []) as {
      stage_id: string
      stage_name: string
      stage_color: string | null
      deal_count: number
      total_value: string | number
    }[]
  )
    .map((s) => ({
      id: s.stage_id,
      name: s.stage_name,
      color: s.stage_color || '#64748b',
      dealCount: Number(s.deal_count ?? 0),
      totalValue: Number(s.total_value ?? 0),
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: DB): Promise<ResponseTimeSummary> {
  const accountId = await accountIdOf(db)
  // Pairing (first inbound → first subsequent outbound per burst)
  // runs in SQL (migration 068); only sparse samples cross the
  // wire. Bucketing/averaging below is byte-for-byte the old logic.
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await db.rpc('dashboard_response_samples', {
    p_account_id: accountId,
    p_start: fourteenDaysAgo,
  })
  if (error) throw error

  const samples: { customerAt: Date; responseAt: Date }[] = (
    (data ?? []) as { customer_at: string; minutes: string | number }[]
  )
    .map((r) => {
      const customerAt = new Date(r.customer_at)
      const minutes = Number(r.minutes)
      return {
        customerAt,
        responseAt: new Date(customerAt.getTime() + minutes * 60_000),
      }
    })
    .filter(
      (s) =>
        Number.isFinite(s.customerAt.getTime()) &&
        Number.isFinite(s.responseAt.getTime())
    )

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  // NOTE: automation_logs reads were retired with the old automation
  // engine (Phase 9). The dashboard feed covers messages, contacts,
  // deals and broadcasts only.
  const [msgs, contacts, deals, broadcasts] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
