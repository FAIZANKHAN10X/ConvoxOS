import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityType =
  | 'message_inbound'
  | 'message_outbound'
  | 'automation_executed'
  | 'automation_failed'
  | 'flow_executed'
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

export async function getContactActivityFeed(
  supabase: SupabaseClient,
  opts: ActivityFeedOptions
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
  const activities: ActivityItem[] = []

  // Use Promise.all to fetch in parallel
  const [
    messagesRes,
    automationLogsRes,
    flowRunsRes,
    tagsRes,
    tasksRes,
    dealsRes,
    notesRes,
    enrollmentsRes,
  ] = await Promise.all([
    // Messages via conversations for this contact
    supabase
      .from('conversations')
      .select('id')
      .eq('account_id', opts.accountId)
      .eq('contact_id', opts.contactId)
      .limit(1)
      .maybeSingle()
      .then(async (convRes) => {
        const convId = (convRes.data as { id: string } | null)?.id
        if (!convId) return { data: [] }
        return supabase
          .from('messages')
          .select('id, sender_type, content_type, content_text, channel, status, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(limit)
      }),
    supabase
      .from('automation_logs')
      .select('id, automation_id, status, trigger_event, created_at, automations!inner(name)')
      .eq('contact_id', opts.contactId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('flow_runs')
      .select('id, flow_id, status, started_at, ended_at, flows!inner(name)')
      .eq('contact_id', opts.contactId)
      .eq('account_id', opts.accountId)
      .order('started_at', { ascending: false })
      .limit(limit),
    supabase
      .from('contact_tags')
      .select('tag_id, created_at, tags!inner(name)')
      .eq('contact_id', opts.contactId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('tasks')
      .select('id, title, status, due_at, created_at')
      .eq('contact_id', opts.contactId)
      .eq('account_id', opts.accountId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('deals')
      .select('id, title, stage_id, status, created_at, updated_at, pipeline_stages!inner(name)')
      .eq('contact_id', opts.contactId)
      .eq('account_id', opts.accountId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('contact_notes')
      .select('id, note_text, created_at')
      .eq('contact_id', opts.contactId)
      .eq('account_id', opts.accountId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('sequence_enrollments')
      .select('id, sequence_id, status, created_at, completed_at, cancelled_at, sequences!inner(name)')
      .eq('contact_id', opts.contactId)
      .eq('account_id', opts.accountId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  // Messages
  const messages = ((messagesRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const m of messages) {
    const isOutbound = m.sender_type === 'agent' || m.sender_type === 'bot'
    activities.push({
      id: `msg-${String(m.id)}`,
      type: isOutbound ? 'message_outbound' : 'message_inbound',
      title: isOutbound ? 'Message sent' : 'Message received',
      description: String(m.content_text ?? '').slice(0, 120) || `[${String(m.content_type)}]`,
      timestamp: String(m.created_at),
      metadata: { channel: m.channel, status: m.status, content_type: m.content_type },
    })
  }

  // Automation logs
  const logs = ((automationLogsRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const l of logs) {
    const isFailed = l.status === 'failed'
    activities.push({
      id: `auto-${String(l.id)}`,
      type: isFailed ? 'automation_failed' : 'automation_executed',
      title: `Automation ${isFailed ? 'failed' : 'executed'}`,
      description: String((l as unknown as { automations?: { name?: string } }).automations?.name ?? String(l.trigger_event)),
      timestamp: String(l.created_at),
      metadata: { status: l.status, trigger_event: l.trigger_event },
    })
  }

  // Flow runs
  const flows = ((flowRunsRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const f of flows) {
    activities.push({
      id: `flow-${String(f.id)}`,
      type: 'flow_executed',
      title: 'Flow executed',
      description: String((f as unknown as { flows?: { name?: string } }).flows?.name ?? String(f.status)),
      timestamp: String(f.started_at),
      metadata: { status: f.status },
    })
  }

  // Tags
  const tags = ((tagsRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const t of tags) {
    activities.push({
      id: `tag-${String(t.tag_id)}-${String(t.created_at)}`,
      type: 'tag_added',
      title: 'Tag added',
      description: String((t as unknown as { tags?: { name?: string } }).tags?.name ?? String(t.tag_id)),
      timestamp: String(t.created_at),
    })
  }

  // Tasks
  const tasks = ((tasksRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const tk of tasks) {
    activities.push({
      id: `task-${String(tk.id)}`,
      type: 'task_created',
      title: 'Task created',
      description: String(tk.title),
      timestamp: String(tk.created_at),
      metadata: { status: tk.status, due_at: tk.due_at },
    })
  }

  // Deals
  const deals = ((dealsRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const d of deals) {
    activities.push({
      id: `deal-${String(d.id)}`,
      type: 'deal_created',
      title: 'Opportunity created',
      description: `${String(d.title)} — ${String((d as unknown as { pipeline_stages?: { name?: string } }).pipeline_stages?.name ?? String(d.stage_id))}`,
      timestamp: String(d.created_at),
      metadata: { stage_id: d.stage_id, status: d.status },
    })
  }

  // Notes
  const notes = ((notesRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const n of notes) {
    activities.push({
      id: `note-${String(n.id)}`,
      type: 'note_added',
      title: 'Note added',
      description: String(n.note_text).slice(0, 120),
      timestamp: String(n.created_at),
    })
  }

  // Sequence enrollments
  const enrolls = ((enrollmentsRes as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>
  for (const e of enrolls) {
    const status = String(e.status)
    let type: ActivityType = 'sequence_enrolled'
    let title = 'Sequence enrolled'
    if (status === 'completed') {
      type = 'sequence_completed'
      title = 'Sequence completed'
    } else if (status === 'cancelled') {
      type = 'sequence_cancelled'
      title = 'Sequence cancelled'
    }
    activities.push({
      id: `seq-${String(e.id)}`,
      type,
      title,
      description: String((e as unknown as { sequences?: { name?: string } }).sequences?.name ?? String(e.sequence_id)),
      timestamp: String(e.completed_at ?? e.cancelled_at ?? e.created_at),
      metadata: { status },
    })
  }

  // Filter
  let filtered = activities
  if (opts.filter && opts.filter !== 'all') {
    filtered = activities.filter((a) => a.type === opts.filter)
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Pagination: simple cursor is timestamp of last item
  let paginated = filtered
  if (opts.cursor) {
    const cursorTime = new Date(opts.cursor).getTime()
    paginated = filtered.filter((a) => new Date(a.timestamp).getTime() < cursorTime)
  }
  const sliced = paginated.slice(0, limit)
  const nextCursor = sliced.length === limit && sliced.length > 0 ? sliced[sliced.length - 1].timestamp : null

  return { items: sliced, nextCursor }
}
