import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

const ALLOWED_CHANNEL_TARGETS = new Set(["current", "whatsapp", "telegram"])
function isValidChannel(v: unknown): boolean {
  return typeof v === "string" && ALLOWED_CHANNEL_TARGETS.has(v)
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      {
        const ch = (c as unknown as { channel_target?: string }).channel_target
        if (ch != null && ch !== "" && !isValidChannel(ch)) {
          issues.push({ path: `${path}.channel_target`, message: 'channel must be "current", "whatsapp" or "telegram"' })
        } else if (!isValidChannel(ch)) {
          issues.push({ path: `${path}.channel_target`, message: 'channel is required' })
        }
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // Channel-aware: Telegram allows up to 10 buttons vs WhatsApp's 3.
      // We validate the payload against the limits of its declared channel;
      // "current" is treated as WhatsApp (stricter) to avoid publishing
      // a build that would be rejected when Current resolves to WhatsApp.
      const rawCh = (c as unknown as { channel_target?: string }).channel_target
      const effectiveChannel: 'whatsapp' | 'telegram' =
        rawCh === 'telegram' ? 'telegram' : 'whatsapp'
      const result = validateInteractivePayload(c, effectiveChannel)
      if (!result.ok) {
        issues.push({ path: `${path}.interactive`, message: result.error })
      }
      {
        const ch = rawCh
        if (ch != null && ch !== "" && !isValidChannel(ch)) {
          issues.push({ path: `${path}.channel_target`, message: 'channel must be "current", "whatsapp" or "telegram"' })
        } else if (!isValidChannel(ch)) {
          issues.push({ path: `${path}.channel_target`, message: 'channel is required' })
        }
      }
      break
    }
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'title is required' })
      }
      break
    case 'create_task':
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'task title is required' })
      }
      break
    case 'enroll_in_sequence':
      if (!nonEmpty(c.sequence_id)) {
        issues.push({ path: `${path}.sequence_id`, message: 'sequence is required' })
      }
      break
    case 'goal': {
      const cond = (c as unknown as { condition?: unknown }).condition
      if (!cond || typeof cond !== 'object') {
        issues.push({ path: `${path}.condition`, message: 'goal condition is required' })
      } else {
        const cc = cond as { subject?: string; operand?: string }
        if (!nonEmpty(cc.subject)) issues.push({ path: `${path}.condition.subject`, message: 'goal condition subject is required' })
        if (!nonEmpty(cc.operand)) issues.push({ path: `${path}.condition.operand`, message: 'goal condition operand is required' })
      }
      const timeout = (c as unknown as { timeout_hours?: unknown }).timeout_hours
      if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
        issues.push({ path: `${path}.timeout_hours`, message: 'timeout_hours must be > 0' })
      }
      break
    }
    case 'randomizer': {
      const variants = (c.variants as Array<{ id?: string; label?: string; weight?: number }> | undefined) ?? []
      if (variants.length < 2) {
        issues.push({ path: `${path}.variants`, message: 'randomizer needs at least 2 variants' })
      }
      if (variants.length > 6) {
        issues.push({ path: `${path}.variants`, message: 'randomizer allows at most 6 variants' })
      }
      const ids = new Set<string>()
      let sum = 0
      variants.forEach((v, idx) => {
        const base = `${path}.variants[${idx}]`
        if (!v.id?.trim()) issues.push({ path: `${base}.id`, message: `variant ${idx + 1} id is required` })
        else if (ids.has(v.id)) issues.push({ path: `${base}.id`, message: `duplicate variant id "${v.id}"` })
        else ids.add(v.id)
        if (!v.label?.trim()) issues.push({ path: `${base}.label`, message: `variant ${idx + 1} label is required` })
        if (typeof v.weight !== 'number' || v.weight <= 0) issues.push({ path: `${base}.weight`, message: `variant ${idx + 1} weight must be > 0` })
        else sum += v.weight
      })
      if (variants.length >= 2 && Math.abs(sum - 100) > 0.01) {
        issues.push({ path: `${path}.variants`, message: `variant weights must sum to 100 (got ${sum})` })
      }
      const mode = (c as unknown as { mode?: string }).mode
      if (mode !== undefined && mode !== 'sticky' && mode !== 'random') {
        issues.push({ path: `${path}.mode`, message: 'randomizer mode must be "sticky" or "random"' })
      }
      break
    }
    case 'wait': {
      const hasUntil = typeof c.until === 'string' && c.until.trim() !== ''
      const hasDuration = typeof c.amount === 'number' && Number.isFinite(c.amount) && c.amount > 0 && typeof c.unit === 'string' && ['minutes', 'hours', 'days'].includes(c.unit)
      if (hasUntil) {
        const d = new Date(String(c.until))
        if (Number.isNaN(d.getTime())) {
          issues.push({ path: `${path}.until`, message: 'wait until must be a valid ISO datetime' })
        }
      } else if (!hasDuration) {
        // Require either until or valid duration
        if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
          issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0' })
        }
        if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
          issues.push({
            path: `${path}.unit`,
            message: 'wait unit must be minutes, hours, or days',
          })
        }
      }
      break
    }
    case 'condition': {
      const hasMulti = Array.isArray((c as unknown as { conditions?: unknown }).conditions) && ((c as unknown as { conditions: unknown[] }).conditions.length > 0)
      if (hasMulti) {
        const conditions = (c as unknown as { conditions: Array<{ subject?: string; operand?: string; value?: string }> }).conditions
        const match = (c as unknown as { match?: string }).match
        if (match !== undefined && match !== 'all' && match !== 'any') {
          issues.push({ path: `${path}.match`, message: 'match must be "all" or "any"' })
        }
        conditions.forEach((cond, idx) => {
          const base = `${path}.conditions[${idx}]`
          if (!nonEmpty(cond.subject)) {
            issues.push({ path: `${base}.subject`, message: `condition ${idx + 1} subject is required` })
          }
          if (!nonEmpty(cond.operand)) {
            issues.push({ path: `${base}.operand`, message: `condition ${idx + 1} operand is required` })
          }
        })
      } else {
        if (!nonEmpty(c.subject)) {
          issues.push({ path: `${path}.subject`, message: 'condition subject is required' })
        }
        if (!nonEmpty(c.operand)) {
          issues.push({ path: `${path}.operand`, message: 'condition operand is required' })
        }
      }
      break
    }
    case 'send_webhook': {
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required' })
        break
      }
      try {
        const rawUrl = String(c.url)
        // Allow interpolation like https://api.example.com/contacts/{{contact.id}} — validate after interpolating a placeholder
        const testUrl = rawUrl.replace(/\{\{[^}]+\}\}/g, 'placeholder')
        const u = new URL(testUrl)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL' })
      }
      const method = (c as unknown as { method?: string }).method
      if (method !== undefined && !['GET','POST','PUT','PATCH','DELETE'].includes(method)) {
        issues.push({ path: `${path}.method`, message: 'method must be GET, POST, PUT, PATCH or DELETE' })
      }
      const headers = (c as unknown as { headers?: unknown }).headers
      if (headers !== undefined) {
        if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
          issues.push({ path: `${path}.headers`, message: 'headers must be an object' })
        } else {
          for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
            if (!k.trim() || typeof v !== 'string') {
              issues.push({ path: `${path}.headers`, message: `header "${k}" must have a string value` })
            }
            if (/[\r\n]/.test(k) || /[\r\n]/.test(String(v))) {
              issues.push({ path: `${path}.headers`, message: `header "${k}" contains invalid characters` })
            }
          }
        }
      }
      const body = (c as unknown as { body_template?: unknown }).body_template
      if (body !== undefined && body !== null && typeof body !== 'string') {
        issues.push({ path: `${path}.body_template`, message: 'body must be a string' })
      } else if (typeof body === 'string' && body.trim() !== '') {
        // If body is intended to be JSON, validate JSON after interpolation placeholder
        const testBody = body.replace(/\{\{[^}]+\}\}/g, '"placeholder"')
        try {
          JSON.parse(testBody)
        } catch {
          // Not JSON — allow plain text, but if it looks like JSON (starts with { or [) then it must be valid
          const trimmed = testBody.trim()
          if ((trimmed.startsWith('{') || trimmed.startsWith('[')) ) {
            issues.push({ path: `${path}.body_template`, message: 'body is not valid JSON' })
          }
        }
      }
      const m = (method ?? 'POST')
      if (m === 'GET' && typeof body === 'string' && body.trim() !== '') {
        issues.push({ path: `${path}.body_template`, message: 'GET requests should not have a body' })
      }
      break
    }
    case 'close_conversation':
      // No config required.
      break
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}` })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (
      cfg.match_type != null &&
      cfg.match_type !== 'exact' &&
      cfg.match_type !== 'contains' &&
      cfg.match_type !== 'word'
    ) {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact", "contains" or "word"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'at least one reply id is required',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'reply ids cannot be empty strings',
      })
    }
  } else if (triggerType === 'contact_changed') {
    if (!nonEmpty(cfg.field)) {
      issues.push({ path: 'trigger.field', message: 'field is required' })
    }
    // value is optional — when present, must be a string
    if (cfg.value !== undefined && typeof cfg.value !== 'string') {
      issues.push({ path: 'trigger.value', message: 'value must be a string' })
    }
  } else if (triggerType === 'note_added') {
    // No required config — fires on any note for the account
  } else if (triggerType === 'task_added') {
    // No required config — fires on any task for the account
  } else if (triggerType === 'customer_replied') {
    const ch = cfg.channel as string | undefined
    if (ch != null && ch !== 'any' && ch !== 'whatsapp' && ch !== 'telegram') {
      issues.push({ path: 'trigger.channel', message: 'channel must be "any", "whatsapp" or "telegram"' })
    }
  } else if (triggerType === 'opportunity_created') {
    // pipeline_id / stage_id optional filters — when present must be non-empty strings
    if (cfg.pipeline_id !== undefined && !nonEmpty(cfg.pipeline_id)) {
      issues.push({ path: 'trigger.pipeline_id', message: 'pipeline_id must be a non-empty string' })
    }
    if (cfg.stage_id !== undefined && !nonEmpty(cfg.stage_id)) {
      issues.push({ path: 'trigger.stage_id', message: 'stage_id must be a non-empty string' })
    }
  } else if (triggerType === 'pipeline_stage_changed') {
    if (cfg.pipeline_id !== undefined && !nonEmpty(cfg.pipeline_id)) {
      issues.push({ path: 'trigger.pipeline_id', message: 'pipeline_id must be a non-empty string' })
    }
    if (cfg.from_stage_id !== undefined && !nonEmpty(cfg.from_stage_id)) {
      issues.push({ path: 'trigger.from_stage_id', message: 'from_stage_id must be a non-empty string' })
    }
    if (cfg.to_stage_id !== undefined && !nonEmpty(cfg.to_stage_id)) {
      issues.push({ path: 'trigger.to_stage_id', message: 'to_stage_id must be a non-empty string' })
    }
  } else if (triggerType === 'inbound_webhook') {
    if (cfg.path !== undefined && typeof cfg.path !== 'string') {
      issues.push({ path: 'trigger.path', message: 'path must be a string' })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
