import type { SequenceStepType } from '@/types'

export interface ValidationIssue {
  path: string
  message: string
}

export function validateSequenceForActivation(name: string, steps: Array<{ step_type: string; step_config: Record<string, unknown> }>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!name || !name.trim()) issues.push({ path: 'name', message: 'Sequence name is required' })
  if (!steps || steps.length === 0) issues.push({ path: 'steps', message: 'Sequence needs at least one step' })
  steps.forEach((s, i) => {
    const path = `steps[${i}]`
    if (!['send_message','send_buttons','send_list','wait','send_email'].includes(s.step_type)) {
      issues.push({ path, message: `unknown step type: ${s.step_type}` })
    }
    const c = s.step_config ?? {}
    if (s.step_type === 'send_email') {
      if (!c.subject || typeof c.subject !== 'string' || !c.subject.trim()) issues.push({ path: `${path}.subject`, message: 'subject is required' })
      if (!c.text || typeof c.text !== 'string' || !c.text.trim()) issues.push({ path: `${path}.text`, message: 'text is required' })
    } else if (s.step_type === 'send_message') {
      if (!c.text || typeof c.text !== 'string' || !c.text.trim()) issues.push({ path: `${path}.text`, message: 'text is required' })
      const ch = (c as unknown as { channel_target?: string }).channel_target
      if (ch != null && ch !== '' && !['current','whatsapp','telegram'].includes(ch)) issues.push({ path: `${path}.channel_target`, message: 'channel must be current, whatsapp or telegram' })
      else if (!ch) issues.push({ path: `${path}.channel_target`, message: 'channel is required' })
    } else if (s.step_type === 'wait') {
      const hasUntil = typeof c.until === 'string' && c.until.trim() !== ''
      const hasDuration = typeof c.amount === 'number' && c.amount > 0 && ['minutes','hours','days'].includes(String(c.unit))
      if (hasUntil) {
        if (Number.isNaN(new Date(String(c.until)).getTime())) issues.push({ path: `${path}.until`, message: 'until must be valid ISO datetime' })
      } else if (!hasDuration) {
        issues.push({ path: `${path}.amount`, message: 'wait amount must be > 0' })
        if (!['minutes','hours','days'].includes(String(c.unit))) issues.push({ path: `${path}.unit`, message: 'unit must be minutes/hours/days' })
      }
    } else if (s.step_type === 'send_buttons' || s.step_type === 'send_list') {
      // Reuse interactive validation via channel-aware check
      const ch = (c as unknown as { channel_target?: string }).channel_target
      if (ch != null && ch !== '' && !['current','whatsapp','telegram'].includes(ch)) issues.push({ path: `${path}.channel_target`, message: 'channel must be current, whatsapp or telegram' })
      else if (!ch) issues.push({ path: `${path}.channel_target`, message: 'channel is required' })
      // Body required for both
      if (!c.body || typeof c.body !== 'string' || !c.body.trim()) {
        // For sequence send_buttons, body is stored as `text` or `body` depending on builder — allow either
        const body = (c as unknown as { body?: string; text?: string }).body ?? (c as unknown as { text?: string }).text
        if (!body || !body.trim()) issues.push({ path: `${path}.body`, message: 'body is required' })
      }
    }
  })
  return issues
}
