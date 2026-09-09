import { supabaseAdmin } from '@/lib/supabase/admin'
import { dispatchText as dispatchChannelText } from '@/lib/channels/socket'
import type { SequenceEnrollment } from '@/types'

export async function enrollContactInSequence(params: {
  accountId: string
  sequenceId: string
  contactId: string
  // Inherit channel/context from parent automation if any
  triggerChannel?: 'whatsapp' | 'telegram' | null
  vars?: Record<string, unknown>
}): Promise<{ enrollmentId: string; alreadyActive: boolean }> {
  const db = supabaseAdmin()
  // Check existing active enrollment
  const { data: existing } = await db
    .from('sequence_enrollments')
    .select('id')
    .eq('sequence_id', params.sequenceId)
    .eq('contact_id', params.contactId)
    .eq('status', 'active')
    .maybeSingle()
  if (existing) return { enrollmentId: (existing as { id: string }).id, alreadyActive: true }

  const { data: seq } = await db.from('sequences').select('id, account_id').eq('id', params.sequenceId).eq('account_id', params.accountId).maybeSingle()
  if (!seq) throw new Error('Sequence not found')

  const { data: inserted, error } = await db
    .from('sequence_enrollments')
    .insert({
      sequence_id: params.sequenceId,
      account_id: params.accountId,
      contact_id: params.contactId,
      status: 'active',
      current_position: 0,
      next_run_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) {
    // Handle race: if unique violation on active enrollment, treat as alreadyActive
    const msg = (error as { message?: string })?.message ?? ''
    if (msg.includes('duplicate') || msg.includes('unique') || (error as { code?: string })?.code === '23505') {
      const { data: raced } = await db
        .from('sequence_enrollments')
        .select('id')
        .eq('sequence_id', params.sequenceId)
        .eq('contact_id', params.contactId)
        .eq('status', 'active')
        .maybeSingle()
      if (raced) return { enrollmentId: (raced as { id: string }).id, alreadyActive: true }
    }
    throw new Error(`enroll failed: ${error.message}`)
  }
  const enrollmentId = (inserted as { id: string }).id

  // Fire first step immediately (or via pending if wait)
  void runSequenceEnrollment(enrollmentId).catch((e) => console.error('[sequences] run failed:', e))

  return { enrollmentId, alreadyActive: false }
}

export async function cancelSequenceEnrollment(enrollmentId: string, accountId: string): Promise<void> {
  const db = supabaseAdmin()
  await db.from('sequence_enrollments').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', enrollmentId).eq('account_id', accountId)
  // NOTE: old automation_pending_executions wait rows were retired with the
  // automation engine (Phase 9). Sequence waits are driven solely by
  // sequence_enrollments.next_run_at + resumeDueSequenceEnrollments().
}

export async function runSequenceEnrollment(enrollmentId: string): Promise<void> {
  const db = supabaseAdmin()
  const { data: enrollment } = await db.from('sequence_enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (!enrollment) return
  const en = enrollment as SequenceEnrollment & { sequence_id: string; account_id: string; contact_id: string; current_position: number; status: string }
  if (en.status !== 'active') return

  const { data: steps } = await db
    .from('sequence_steps')
    .select('*')
    .eq('sequence_id', en.sequence_id)
    .order('position', { ascending: true })
  if (!steps || steps.length === 0) {
    await db.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollmentId)
    return
  }

  // Find current step
  const pos = en.current_position ?? 0
  if (pos >= (steps as unknown[]).length) {
    await db.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollmentId)
    return
  }

  const step = (steps as Array<{ id: string; step_type: string; step_config: Record<string, unknown>; position: number }>)[pos]
  const cfg = step.step_config as Record<string, unknown>

  // Handle wait step: schedule next run via next_run_at polling.
  // (The old automation_pending_executions durable queue was retired with
  // the automation engine; sequences use next_run_at + resumeDueSequenceEnrollments.)
  if (step.step_type === 'wait') {
    const until = cfg.until as string | undefined
    let runAt: string
    if (until && !Number.isNaN(new Date(until as string).getTime())) {
      runAt = new Date(until as string).toISOString()
    } else {
      const amount = typeof cfg.amount === 'number' ? cfg.amount : 1
      const unit = (cfg.unit as string) ?? 'hours'
      const ms = unit === 'days' ? 86400000 : unit === 'minutes' ? 60000 : 3600000
      runAt = new Date(Date.now() + amount * ms).toISOString()
    }
    // Use next_run_at for polling resume via resumeDueSequenceEnrollments().
    await db.from('sequence_enrollments').update({ next_run_at: runAt, current_position: pos + 1 }).eq('id', enrollmentId)
    return
  }

  // Handle send_message / send_buttons / send_list via ChannelSocket
  try {
    // Resolve conversation for contact
    const { data: conv } = await db.from('conversations').select('id').eq('account_id', en.account_id).eq('contact_id', en.contact_id).maybeSingle()
    if (!conv) throw new Error('contact has no conversation')
    const conversationId = (conv as { id: string }).id
    const channelTarget = (cfg.channel_target as string | undefined) ?? 'current'
    // For sequences, channel_target current should resolve to last inbound channel? For now, default to whatsapp if current and no context
    let channel: 'whatsapp' | 'telegram' = 'whatsapp'
    if (channelTarget === 'telegram') channel = 'telegram'
    else if (channelTarget === 'whatsapp') channel = 'whatsapp'
    else {
      // current — try to infer from last message, else whatsapp
      const { data: lastMsg } = await db.from('messages').select('channel').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const lastChannel = (lastMsg as { channel?: string } | null)?.channel
      if (lastChannel === 'telegram' || lastChannel === 'whatsapp') channel = lastChannel as 'whatsapp' | 'telegram'
    }

    if (step.step_type === 'send_message') {
      const text = (cfg.text as string) ?? (cfg.body as string) ?? ''
      if (!text.trim()) throw new Error('send_message text required')
      await dispatchChannelText({ db, accountId: en.account_id, conversationId, channel, text })
    } else if (step.step_type === 'send_buttons' || step.step_type === 'send_list') {
      // For sequences, send_buttons/send_list are stored as interactive payload same as automations
      // For telegram, dispatchChannelText will handle inline keyboard conversion via dispatchInteractive? For now, use dispatchText with inlineKeyboard if telegram
      const payload = cfg as unknown as { body?: string; text?: string; buttons?: Array<{ id: string; title: string }>; sections?: Array<{ rows: Array<{ id: string; title: string }> }> }
      const body = (payload.body as string) ?? (payload.text as string) ?? 'Choose:'
      // Build inline keyboard for telegram from buttons or list rows
      let inlineKeyboard: import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup | null = null
      if (channel === 'telegram') {
        if (payload.buttons) {
          inlineKeyboard = { inline_keyboard: payload.buttons.map((b) => [{ text: b.title, callback_data: b.id }]) } as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
        } else if (payload.sections) {
          const rows = (payload.sections as Array<{ rows: Array<{ id: string; title: string }> }>).flatMap((s) => s.rows)
          inlineKeyboard = { inline_keyboard: rows.map((r) => [{ text: r.title, callback_data: r.id }]) } as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
        }
      }
      if (channel === 'telegram' && inlineKeyboard) {
        await dispatchChannelText({ db, accountId: en.account_id, conversationId, channel: 'telegram', text: body, inlineKeyboard })
      } else {
        // For whatsapp, use dispatchText for buttons? For now, use dispatchChannelText with inlineKeyboard not supported for whatsapp, so use dispatchText
        // For simplicity, send as text with body
        await dispatchChannelText({ db, accountId: en.account_id, conversationId, channel, text: body, inlineKeyboard: inlineKeyboard ?? undefined })
      }
    }

    // Advance to next position
    const nextPos = pos + 1
    if (nextPos >= (steps as unknown[]).length) {
      await db.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString(), current_position: nextPos }).eq('id', enrollmentId)
    } else {
      // Check if next step is a wait — if so, schedule it via next_run_at logic on next invocation, but for now just advance and let next run handle it
      // For immediate next send, we update position and then recursively run next step immediately (if not wait)
      await db.from('sequence_enrollments').update({ current_position: nextPos, next_run_at: new Date().toISOString() }).eq('id', enrollmentId)
      // If next step is not a wait, continue immediately
      const nextStep = (steps as Array<{ step_type: string }>)[nextPos]
      if (nextStep && nextStep.step_type !== 'wait') {
        // Continue immediately to next step (tail recursion)
        await runSequenceEnrollment(enrollmentId)
      } else if (nextStep && nextStep.step_type === 'wait') {
        // Let the wait handling on next invocation schedule the pending
        await runSequenceEnrollment(enrollmentId)
      }
    }
  } catch (e) {
    console.error('[sequences] step failed:', e)
    // Mark enrollment as cancelled on failure? For now, keep active but log
    await db.from('sequence_enrollments').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', enrollmentId)
  }
}

// Cron helper to resume due enrollments
export async function resumeDueSequenceEnrollments(): Promise<number> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const { data: due } = await db
    .from('sequence_enrollments')
    .select('id')
    .eq('status', 'active')
    .lte('next_run_at', now)
    .limit(50)
  if (!due || due.length === 0) return 0
  let resumed = 0
  for (const row of due as Array<{ id: string }>) {
    try {
      await runSequenceEnrollment(row.id)
      resumed++
    } catch (e) {
      console.error('[sequences] resumeDue failed:', e)
    }
  }
  return resumed
}
