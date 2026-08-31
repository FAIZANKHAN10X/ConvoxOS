import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  InteractiveReplyTriggerConfig,
  TagTriggerConfig,
  SendMessageStepConfig,
  SendButtonsStepConfig,
  SendListStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write'
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from '@/lib/contacts/tag-chain'

const MAX_CONTACT_CHANGED_DEPTH = 5
function getContactChangedDepth(ctx?: AutomationContext): number {
  const v = (ctx?.vars as Record<string, unknown> | undefined)?.['_contact_changed_depth']
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
import { engineSendTemplate, engineSendInteractive } from './meta-send'
import { dispatchText as dispatchChannelText, dispatchInteractive as dispatchChannelInteractive } from '@/lib/channels/socket'
import type { AutomationChannelTarget } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Channel that triggered this automation, if conversational. */
  trigger_channel?: 'whatsapp' | 'telegram' | null
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
  /** Button / list-row id the customer tapped, for interactive_reply. */
  interactive_reply_id?: string
  // P1 — Contact
  contact_changed_field?: string
  contact_changed_value?: string
  contact_changed_old_value?: string
  // P1 — Note
  note_id?: string
  note_text?: string
  // P1 — Task
  task_id?: string
  task_title?: string
  // P1 — Opportunity
  opportunity_id?: string
  pipeline_id?: string
  stage_id?: string
  from_stage_id?: string
  to_stage_id?: string
  // P1 — Business Event
  webhook_path?: string
  webhook_payload?: Record<string, unknown>
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

export function resolveAutomationChannelTarget(
  rawTarget: string | null | undefined,
  triggerChannel: string | null | undefined,
): 'whatsapp' | 'telegram' | null {
  const target = (rawTarget ?? null) as AutomationChannelTarget | null;
  if (target == null) return 'whatsapp'; // legacy → whatsapp
  if (target === 'current') {
    if (triggerChannel === 'whatsapp' || triggerChannel === 'telegram') return triggerChannel;
    return null;
  }
  if (target === 'whatsapp' || target === 'telegram') return target;
  return null;
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const db = supabaseAdmin()

    // Tenant isolation. `contactId` can be caller-supplied (the manual
    // POST /api/automations/engine entrypoint reads it straight from the
    // request body), and every step below runs through the service-role
    // client, which bypasses RLS. So before any step can touch the
    // contact, verify it actually belongs to this account. A foreign or
    // forged id is refused silently — callers are fire-and-forget, and a
    // distinct error would leak whether a given contact UUID exists.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle()
      if (ownErr) {
        console.error('[automations] contact ownership check failed:', ownErr)
        return
      }
      if (!owned) {
        console.warn('[automations] contact not in account, refusing dispatch', input.contactId)
        return
      }
    }

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true)

    if (error) {
      console.error('[automations] fetch failed:', error)
      return
    }
    if (!automations || automations.length === 0) return

    for (const automation of automations as Automation[]) {
      const matched = triggerMatches(automation, input.context)
      // Log every evaluation for truthful stats (attempted/matched/unmatched), fire-and-forget
      void (async () => {
        try {
          await supabaseAdmin().from('automation_trigger_evaluations').insert({
            automation_id: automation.id,
            account_id: automation.account_id,
            contact_id: input.contactId ?? null,
            trigger_type: automation.trigger_type,
            matched,
          })
        } catch {}
      })()
      if (!matched) continue
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    })
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin()

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      // Tenancy: matches automation.account_id (NOT NULL post-017).
      account_id: automation.account_id,
      // Audit: keeps the historical "author of this automation"
      // pointer so logs still attribute to the right user even
      // after teammates join the account.
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: input.triggerType,
      steps_executed: [],
      // Seeded pessimistically. The row is written BEFORE any step runs,
      // and every terminal path below overwrites it (`appendResults` at
      // the outermost scope, or `finalizeLog`). Seeding 'success' meant a
      // run that died mid-flight — the process frozen, the pod recycled —
      // left a permanent `status: 'success'` with `steps_executed: []`,
      // indistinguishable from an automation that genuinely had nothing
      // to do. 'failed' inverts that: the status only becomes success if
      // execution actually reached the end. See issue #409.
      status: 'failed',
    })
    .select()
    .single()

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr)
    return
  }

  await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: log.id,
    triggerEvent: input.triggerType,
  })

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const db = supabaseAdmin()

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      const ms = waitMs(cfg)
      await db.from('automation_pending_executions').insert({
        automation_id: args.automation.id,
        // Tenancy: account_id required NOT NULL post-017.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        contact_id: args.contactId,
        log_id: args.logId,
        parent_step_id: args.parentStepId,
        branch: args.branch,
        next_step_position: step.position + 1,
        context: args.context,
        run_at: new Date(Date.now() + ms).toISOString(),
        status: 'pending',
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    if (step.step_type === 'randomizer') {
      const cfg = step.step_config as unknown as { variants: Array<{ id: string; label: string; weight: number }>; mode?: string }
      const variants = cfg.variants ?? []
      if (variants.length === 0) {
        results.push({ step_id: step.id, step_type: 'randomizer', status: 'failed', detail: 'no variants' })
        status = 'failed'
        errorMessage = 'randomizer needs variants'
        break
      }
      const total = variants.reduce((sum, v) => sum + (typeof v.weight === 'number' ? v.weight : 0), 0)
      let r = Math.random() * total
      let chosen = variants[0]
      for (const v of variants) {
        r -= (typeof v.weight === 'number' ? v.weight : 0)
        if (r <= 0) {
          chosen = v
          break
        }
      }
      results.push({ step_id: step.id, step_type: 'randomizer', status: 'success', detail: `chose ${chosen.id} (${chosen.label})` })
      if (!args.context.vars) args.context.vars = {}
      args.context.vars[`_randomizer_${step.id}`] = chosen.id
      continue
    }

    if (step.step_type === 'goal') {
      const cfg = step.step_config as unknown as { condition: { subject: string; operand?: string; value?: string }; timeout_hours?: number }
      const cond = cfg.condition
      if (!cond || !cond.subject) {
        results.push({ step_id: step.id, step_type: 'goal', status: 'failed', detail: 'goal missing condition' })
        status = 'failed'
        errorMessage = 'goal missing condition'
        break
      }
      const satisfied = await evaluateCondition(cond as unknown as ConditionStepConfig, args).catch(() => false)
      if (satisfied) {
        results.push({ step_id: step.id, step_type: 'goal', status: 'success', detail: 'goal satisfied immediately' })
        continue
      }
      const timeoutHours = typeof cfg.timeout_hours === 'number' && cfg.timeout_hours > 0 ? cfg.timeout_hours : 24
      const runAt = new Date(Date.now() + timeoutHours * 3600000).toISOString()
      await db.from('automation_pending_executions').insert({
        automation_id: args.automation.id,
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        contact_id: args.contactId,
        log_id: args.logId,
        parent_step_id: args.parentStepId,
        branch: args.branch,
        next_step_position: step.position + 1,
        context: {
          ...args.context,
          _goal_condition: cond,
          _goal_step_id: step.id,
          _goal_timeout_hours: timeoutHours,
        },
        run_at: runAt,
        status: 'pending',
      })
      results.push({ step_id: step.id, step_type: 'goal', status: 'success', detail: `waiting for goal (timeout ${timeoutHours}h)` })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const channel = resolveAutomationChannelTarget(
        (cfg as unknown as { channel_target?: string }).channel_target,
        (args.context as unknown as { trigger_channel?: string | null })?.trigger_channel ?? null,
      )
      if (!channel) throw new Error('Current requires inbound channel — choose WhatsApp or Telegram explicitly')
      const { providerMessageId } = await dispatchChannelText({
        db,
        accountId: args.automation.account_id,
        conversationId,
        channel,
        text,
      })
      return `sent via ${channel} (${providerMessageId})`
    }

    case 'send_buttons':
    case 'send_list': {
      const payload = step.step_config as SendButtonsStepConfig | SendListStepConfig
      if (!args.contactId) throw new Error(`${step.step_type} needs a contact`)
      const channel = resolveAutomationChannelTarget(
        (payload as unknown as { channel_target?: string }).channel_target,
        (args.context as unknown as { trigger_channel?: string | null })?.trigger_channel ?? null,
      )
      if (!channel) throw new Error('Current requires inbound channel — choose WhatsApp or Telegram explicitly')
      // Validate per-channel before network
      if (channel === 'whatsapp') {
        const check = validateInteractivePayload(payload)
        if (!check.ok) throw new Error(check.error)
      }
      const conversationId = await resolveConversationId(args)
      // For Telegram, convert canonical InteractiveMessagePayload (WhatsApp shape) to Telegram inline keyboard
      // using the same mapping as Flow engine (src/lib/flows/engine.ts) — reuse canonical payload, not a new contract
      if (channel === 'telegram') {
        const p = payload as unknown as import('@/lib/whatsapp/interactive').InteractiveMessagePayload
        let inlineKeyboard: import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
        let text: string
        if (p.kind === 'buttons') {
          inlineKeyboard = { inline_keyboard: p.buttons.map((b) => [{ text: b.title, callback_data: b.id }]) } as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
          text = p.body || 'Choose an option:'
        } else if (p.kind === 'list') {
          inlineKeyboard = { inline_keyboard: p.sections.flatMap((s) => s.rows.map((r) => [{ text: r.title, callback_data: r.id }])) } as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
          text = p.body || 'Choose an option:'
        } else {
          inlineKeyboard = { inline_keyboard: [] } as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup
          text = (p as unknown as { body?: string }).body || 'Choose an option:'
        }
        const { providerMessageId } = await dispatchChannelText({
          db,
          accountId: args.automation.account_id,
          conversationId,
          channel: 'telegram',
          text,
          inlineKeyboard,
        })
        return `interactive sent via ${channel} (${providerMessageId})`
      }
      const { providerMessageId } = await dispatchChannelInteractive({
        db,
        accountId: args.automation.account_id,
        conversationId,
        channel,
        payload: payload as unknown as import('@/lib/whatsapp/interactive').InteractiveMessagePayload,
      })
      return `interactive sent via ${channel} (${providerMessageId})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const channel = resolveAutomationChannelTarget(
        (cfg as unknown as { channel_target?: string }).channel_target,
        (args.context as unknown as { trigger_channel?: string | null })?.trigger_channel ?? null,
      )
      if (channel && channel !== 'whatsapp') {
        throw new Error('Templates are only supported for WhatsApp')
      }
      // Legacy missing channel_target → whatsapp (handled by resolve), explicit telegram should have thrown above
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      const added = await addContactTagIfAbsent(db, {
        accountId: args.automation.account_id,
        contactId: args.contactId,
        tagId: cfg.tag_id,
      })
      if (!added) return `tag ${cfg.tag_id} already present`

      const depth = getTagChainDepth(args.context)
      if (depth >= MAX_TAG_CHAIN_DEPTH) {
        console.warn('[automations] tag_added chain depth limit reached', {
          automationId: args.automation.id,
          contactId: args.contactId,
          tagId: cfg.tag_id,
          depth,
        })
        return `tag ${cfg.tag_id} added; tag_added dispatch skipped at depth ${depth}`
      }

      await runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'tag_added',
        contactId: args.contactId,
        context: {
          ...args.context,
          tag_id: cfg.tag_id,
          vars: {
            ...(args.context.vars ?? {}),
            _tag_chain_depth: depth + 1,
          },
        },
      })
      return `tag ${cfg.tag_id} added and tag_added dispatched`
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        // Pick any member of the account. The existing implementation
        // only ever returned the automation's author; preserving that
        // shape until a real round-robin algorithm replaces it.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', args.automation.account_id)
          .limit(1)
        agentId = profiles?.[0]?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      // Resolve workflow variables ({{ vars.* }}, {{ message.text }}) so custom
      // values can be populated dynamically from the triggering context.
      const value = interpolate(cfg.value, args)

      // Custom fields are encoded as `custom:<custom_field_id>`; anything else
      // is a built-in contact column.
      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length)
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`
        }
        // Defense in depth: the service-role client bypasses RLS, so confirm
        // the field definition belongs to this account before writing.
        const { data: field } = await db
          .from('custom_fields')
          .select('id')
          .eq('id', customFieldId)
          .eq('account_id', args.automation.account_id)
          .maybeSingle()
        if (!field) {
          return `field ${cfg.field} not writable from automations`
        }
        // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
        // runs overwrite rather than duplicate. Tenancy is enforced above and,
        // for the contact side, by the entry-point ownership guard.
        await db
          .from('contact_custom_values')
          .upsert(
            { contact_id: args.contactId, custom_field_id: customFieldId, value },
            { onConflict: 'contact_id,custom_field_id' },
          )
        // Fire contact_changed trigger (P1) — custom field + check pending goals
        {
          const depth = getContactChangedDepth(args.context)
          if (depth < MAX_CONTACT_CHANGED_DEPTH) {
            void runAutomationsForTrigger({
              accountId: args.automation.account_id,
              triggerType: 'contact_changed',
              contactId: args.contactId,
              context: {
                ...args.context,
                contact_changed_field: cfg.field,
                contact_changed_value: value,
                vars: { ...(args.context.vars ?? {}), _contact_changed_depth: depth + 1 },
              },
            }).catch((e) => console.error('[automations] contact_changed dispatch failed:', e))
          }
          void checkPendingGoalsForContact(args.automation.account_id, args.contactId, { contact_changed_field: cfg.field, contact_changed_value: value, ...args.context }).catch((e) => console.error('[goals] checkPendingGoalsForContact failed:', e))
        }
        return `custom field updated`
      }

      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
      // Fire contact_changed trigger (P1) + check pending goals
      {
        const depth = getContactChangedDepth(args.context)
        if (depth < MAX_CONTACT_CHANGED_DEPTH) {
          void runAutomationsForTrigger({
            accountId: args.automation.account_id,
            triggerType: 'contact_changed',
            contactId: args.contactId,
            context: {
              ...args.context,
              contact_changed_field: cfg.field,
              contact_changed_value: value,
              vars: { ...(args.context.vars ?? {}), _contact_changed_depth: depth + 1 },
            },
          }).catch((e) => console.error('[automations] contact_changed dispatch failed:', e))
        }
        void checkPendingGoalsForContact(args.automation.account_id, args.contactId, { contact_changed_field: cfg.field, contact_changed_value: value, ...args.context }).catch((e) => console.error('[goals] checkPendingGoalsForContact failed:', e))
      }
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      // Match the account's configured default currency rather than
      // the static `deals.currency` DB default — keeps automation-
      // created deals consistent with the one-currency-per-account
      // rule (issue #218). Fall back to USD if the row is somehow
      // missing the value (pre-021 forks).
      const { data: acct } = await db
        .from('accounts')
        .select('default_currency')
        .eq('id', args.automation.account_id)
        .maybeSingle()
      await db.from('deals').insert({
        // Tenancy + audit, same split as automation_logs above.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        pipeline_id: cfg.pipeline_id,
        stage_id: cfg.stage_id,
        contact_id: args.contactId,
        title: interpolate(cfg.title, args),
        value: cfg.value ?? 0,
        currency: acct?.default_currency ?? 'USD',
        status: 'open',
      })
      return 'deal created'
    }

    case 'create_task': {
      const cfg = step.step_config as unknown as { title?: string; description?: string; due_at?: string; assigned_to?: string }
      const title = interpolate(cfg.title ?? '', args).trim()
      if (!title) throw new Error('create_task needs title')
      const description = cfg.description != null ? interpolate(String(cfg.description), args) : null
      let dueAt: string | null = null
      if (cfg.due_at) {
        const parsed = new Date(interpolate(String(cfg.due_at), args))
        if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString()
      }
      const assignedTo: string | null = cfg.assigned_to ?? null
      if (assignedTo) {
        const { data: member } = await db
          .from('profiles')
          .select('user_id')
          .eq('user_id', assignedTo)
          .eq('account_id', args.automation.account_id)
          .maybeSingle()
        if (!member) throw new Error(`create_task: assigned_to ${assignedTo} is not a member of this account`)
      }
      const { data: insertedTask, error: taskErr } = await db
        .from('tasks')
        .insert({
          account_id: args.automation.account_id,
          user_id: args.automation.user_id,
          contact_id: args.contactId ?? null,
          assigned_to: assignedTo,
          title,
          description,
          due_at: dueAt,
          status: 'open',
          source_automation_id: args.automation.id,
        })
        .select('id')
        .single()
      if (taskErr) throw new Error(`create_task failed: ${taskErr.message}`)
      void runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'task_added',
        contactId: args.contactId ?? null,
        context: {
          ...args.context,
          task_id: (insertedTask as { id: string }).id,
          task_title: title,
        },
      }).catch((e) => console.error('[automations] task_added dispatch failed:', e))
      return `task created ${(insertedTask as { id: string }).id}`
    }

    case 'enroll_in_sequence': {
      const cfg = step.step_config as unknown as { sequence_id: string }
      if (!cfg.sequence_id) throw new Error('enroll_in_sequence needs sequence_id')
      if (!args.contactId) throw new Error('enroll_in_sequence needs a contact')
      const { enrollContactInSequence } = await import('@/lib/sequences/engine')
      const { enrollmentId, alreadyActive } = await enrollContactInSequence({
        accountId: args.automation.account_id,
        sequenceId: cfg.sequence_id,
        contactId: args.contactId,
        triggerChannel: (args.context.trigger_channel as 'whatsapp' | 'telegram' | null) ?? null,
        vars: args.context.vars,
      })
      return alreadyActive ? `already enrolled ${enrollmentId}` : `enrolled ${enrollmentId}`
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const method = (cfg.method ?? 'POST').toUpperCase()
      if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error(`unsupported method ${method}`)
      const interpolatedUrl = interpolate(cfg.url, args)
      if (!(await isDeliverableUrl(interpolatedUrl))) {
        throw new Error('send_webhook: destination not allowed')
      }
      // Interpolate headers
      const headers: Record<string, string> = {}
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers)) {
          headers[k] = interpolate(String(v), args)
        }
      }
      // Body handling: GET/DELETE should not have body, others can
      let body: string | undefined = undefined
      if (cfg.body_template != null && cfg.body_template !== '') {
        body = interpolate(String(cfg.body_template), args)
      } else if (method !== 'GET' && method !== 'DELETE') {
        body = JSON.stringify(args.context)
        if (!headers['content-type']) headers['content-type'] = 'application/json'
      }
      if (method === 'GET' && body) throw new Error('GET requests should not have a body')
      const start = Date.now()
      let res: Response
      try {
        res = await fetch(interpolatedUrl, {
          method,
          headers,
          body: method === 'GET' || method === 'DELETE' ? undefined : body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[webhook] fetch failed:', { method, url: interpolatedUrl, error: msg, duration: Date.now() - start })
        throw new Error(`webhook fetch failed: ${msg}`)
      }
      const duration = Date.now() - start
      // Read response (bounded to 100KB to avoid giant persistence)
      let text = ''
      let json: unknown = null
      try {
        text = await res.text()
        if (text.length > 100 * 1024) text = text.slice(0, 100 * 1024) + '…[truncated]'
        try {
          json = JSON.parse(text)
        } catch {
          // not JSON, keep text
        }
      } catch (e) {
        console.error('[webhook] read body failed:', e)
      }
      // Logging (redact Authorization)
      const safeHeaders = { ...headers }
      if (safeHeaders['authorization']) safeHeaders['authorization'] = '[REDACTED]'
      if (safeHeaders['Authorization']) safeHeaders['Authorization'] = '[REDACTED]'
      console.log('[webhook]', { method, url: interpolatedUrl, status: res.status, duration, headers: safeHeaders })

      // Store response in vars if requested
      if (cfg.store_response) {
        const varName = (cfg.response_var && cfg.response_var.trim()) ? cfg.response_var.trim() : 'external_response'
        if (!args.context.vars) args.context.vars = {}
        // Bound response storage to 10KB JSON
        const toStore = json !== null ? json : text
        const str = JSON.stringify(toStore)
        const limited = str.length > 10 * 1024 ? str.slice(0, 10 * 1024) : str
        try {
          args.context.vars[varName] = JSON.parse(limited)
        } catch {
          args.context.vars[varName] = limited
        }
      }

      if (!res.ok) throw new Error(`webhook returned ${res.status}: ${text.slice(0, 500)}`)
      return `webhook ${res.status}${json ? ' json' : ' text'}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) {
    const prefix = args.triggerEvent === 'tag_added'
      ? 'tag_added automation cannot send'
      : 'cannot send'
    throw new Error(`${prefix}: contact has no existing conversation`)
  }
  return data.id as string
}

/** Letter, digit or underscore in any script — the "inside a word" test. */
const WORD_CHAR = '[\\p{L}\\p{N}_]'

/**
 * Whole-word keyword test, behind `match_type: 'word'` (issue #409 — a
 * one-letter keyword under `contains` fires on every message containing
 * that letter, e.g. "k" on "thanks").
 *
 * Deliberately NOT `\b`, which is defined against `[A-Za-z0-9_]` and so
 * breaks two cases that matter for WhatsApp traffic:
 *
 *   - A keyword carrying punctuation: `/\bhi!\b/` demands a word character
 *     after the "!", so it never matches "say hi!".
 *   - Any non-Latin script: every character of "안녕" is a non-word
 *     character to `\b`, so `/\b안녕\b/` matches nothing at all.
 *
 * Unicode-aware lookarounds handle both. Note this really is word-based:
 * it won't find "안녕" inside "안녕하세요", because a language that doesn't
 * delimit words with spaces has no word edge there. That's what `contains`
 * is for, and it stays the default.
 *
 * Exported for direct unit testing of the escaping / boundary edges.
 */
export function matchesWholeWord(
  text: string,
  keyword: string,
  caseSensitive = false,
): boolean {
  if (!keyword) return false
  // The keyword is account-supplied free text, so metacharacters have to
  // be literal — otherwise "(" is an unterminated group and RegExp throws.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu',
  )
  return pattern.test(text)
}

export function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type === 'keyword_match') {
    const cfg = automation.trigger_config as KeywordMatchTriggerConfig
    // Channel filter for message-related triggers
    const cfgChannel = (cfg as unknown as { channel?: string }).channel
    const ctxChannel = (ctx as unknown as { trigger_channel?: string | null })?.trigger_channel
    if (cfgChannel && cfgChannel !== 'any' && ctxChannel && cfgChannel !== ctxChannel) return false
    if (cfgChannel && cfgChannel !== 'any' && !ctxChannel) return false
    if (!cfg?.keywords || cfg.keywords.length === 0) return false
    const text = (ctx?.message_text ?? '').toString()
    if (!text) return false
    if (cfg.match_type === 'word') {
      return cfg.keywords.some((raw) =>
        matchesWholeWord(text, raw, cfg.case_sensitive),
      )
    }
    const haystack = cfg.case_sensitive ? text : text.toLowerCase()
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase()
      return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
    })
  }

  // Match on the tapped button / list-row id (exact). Lets multi-step
  // menus be chained: automation A sends buttons, automation B fires on
  // the reply id and sends the next step.
  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig
    const cfgChannel = (cfg as unknown as { channel?: string }).channel
    const ctxChannel = (ctx as unknown as { trigger_channel?: string | null })?.trigger_channel
    if (cfgChannel && cfgChannel !== 'any' && ctxChannel && cfgChannel !== ctxChannel) return false
    if (cfgChannel && cfgChannel !== 'any' && !ctxChannel) return false
    const replyId = ctx?.interactive_reply_id
    if (!replyId || !Array.isArray(cfg?.reply_ids) || cfg.reply_ids.length === 0) {
      return false
    }
    return cfg.reply_ids.includes(replyId)
  }

  if (automation.trigger_type === 'tag_added') {
    const cfg = automation.trigger_config as TagTriggerConfig
    const tagId = ctx?.tag_id
    return Boolean(tagId && cfg?.tag_id && cfg.tag_id === tagId)
  }

  // P1 — Contact changed
  if (automation.trigger_type === 'contact_changed') {
    const cfg = automation.trigger_config as unknown as { field?: string; value?: string }
    const changedField = ctx?.contact_changed_field
    const changedValue = ctx?.contact_changed_value
    if (!changedField || !cfg?.field) return false
    if (cfg.field !== changedField) return false
    if (cfg.value !== undefined && cfg.value !== '' && String(changedValue ?? '') !== String(cfg.value)) return false
    return true
  }

  if (automation.trigger_type === 'note_added') {
    return Boolean(ctx?.note_id)
  }

  if (automation.trigger_type === 'task_added') {
    return Boolean(ctx?.task_id)
  }

  if (automation.trigger_type === 'customer_replied') {
    const cfg = automation.trigger_config as unknown as { channel?: string }
    const cfgChannel = cfg?.channel as string | undefined
    const ctxChannel = (ctx as unknown as { trigger_channel?: string | null })?.trigger_channel
    if (cfgChannel && cfgChannel !== 'any' && ctxChannel && cfgChannel !== ctxChannel) return false
    if (cfgChannel && cfgChannel !== 'any' && !ctxChannel) return false
    const text = (ctx?.message_text ?? '').toString()
    return Boolean(text && text.trim().length > 0)
  }

  if (automation.trigger_type === 'opportunity_created') {
    const cfg = automation.trigger_config as unknown as { pipeline_id?: string; stage_id?: string }
    if (!ctx?.opportunity_id) return false
    if (cfg?.pipeline_id && cfg.pipeline_id !== ctx.pipeline_id) return false
    if (cfg?.stage_id && cfg.stage_id !== ctx.stage_id) return false
    return true
  }

  if (automation.trigger_type === 'pipeline_stage_changed') {
    const cfg = automation.trigger_config as unknown as { pipeline_id?: string; from_stage_id?: string; to_stage_id?: string }
    if (!ctx?.opportunity_id) return false
    if (cfg?.pipeline_id && cfg.pipeline_id !== ctx.pipeline_id) return false
    if (cfg?.from_stage_id && cfg.from_stage_id !== ctx.from_stage_id) return false
    if (cfg?.to_stage_id && cfg.to_stage_id !== ctx.to_stage_id) return false
    return true
  }

  if (automation.trigger_type === 'inbound_webhook') {
    const cfg = automation.trigger_config as unknown as { path?: string }
    if (cfg?.path && cfg.path !== ctx?.webhook_path) return false
    return true
  }

  return true
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const v = (data as Record<string, unknown> | null)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

export async function checkPendingGoalsForContact(accountId: string, contactId: string, ctx: AutomationContext): Promise<void> {
  const db = supabaseAdmin()
  const { data: pending } = await db.from('automation_pending_executions').select('*').eq('account_id', accountId).eq('contact_id', contactId).eq('status', 'pending')
  if (!pending || pending.length === 0) return
  for (const p of pending as Array<{ id: string; context: Record<string, unknown>; automation_id: string; log_id: string | null; parent_step_id: string | null; branch: string | null; next_step_position: number }>) {
    const goalCond = (p.context as Record<string, unknown>)?._goal_condition as unknown as import('@/types').ConditionStepConfig | undefined
    if (!goalCond) continue
    const automation = { id: p.automation_id, account_id: accountId } as unknown as import('@/types').Automation
    const args: ExecuteArgs = {
      automation: automation as import('@/types').Automation,
      contactId,
      context: { ...ctx, ...(p.context as AutomationContext), vars: { ...((p.context as unknown as { vars?: Record<string, unknown> })?.vars ?? {}), ...ctx.vars } },
      parentStepId: p.parent_step_id,
      branch: p.branch as 'yes' | 'no' | null,
      startPosition: p.next_step_position,
      logId: p.log_id,
      triggerEvent: 'goal_satisfied',
    }
    try {
      const satisfied = await evaluateCondition(goalCond, args)
      if (satisfied) {
        await db.from('automation_pending_executions').update({ run_at: new Date().toISOString() }).eq('id', p.id)
      }
    } catch (e) {
      console.error('[goals] evaluate pending goal failed:', e)
    }
  }
}

function waitMs(cfg: WaitStepConfig): number {
  if (cfg.until) {
    const untilDate = new Date(cfg.until)
    if (!Number.isNaN(untilDate.getTime())) {
      return Math.max(1_000, untilDate.getTime() - Date.now())
    }
  }
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, (cfg.amount ?? 1) * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  await db.from('automation_logs').update(update).eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId)
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
}
