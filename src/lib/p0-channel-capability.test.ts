import { describe, expect, it } from 'vitest'
import { validateInteractivePayload } from './whatsapp/interactive'
import { validateStepsForActivation } from './automations/validate'
import { validateFlowForActivation } from './flows/validate'

function makeButtons(count: number, opts: { title?: string; idPrefix?: string } = {}) {
  const prefix = opts.idPrefix ?? 'btn'
  const title = opts.title ?? 'Option'
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}_${i}`, title: `${title} ${i}` }))
}

describe('P0 — Telegram channel capability (10) vs WhatsApp (3)', () => {
  describe('validateInteractivePayload — channel aware', () => {
    it('Telegram: valid payload with 5 buttons succeeds', () => {
      const res = validateInteractivePayload(
        { kind: 'buttons', body: 'Pick', buttons: makeButtons(5) },
        'telegram',
      )
      expect(res).toEqual({ ok: true })
    })
    it('Telegram: 10 buttons succeeds (max)', () => {
      const res = validateInteractivePayload(
        { kind: 'buttons', body: 'Pick', buttons: makeButtons(10) },
        'telegram',
      )
      expect(res.ok).toBe(true)
    })
    it('Telegram: 11 buttons fails with Telegram limit', () => {
      const res = validateInteractivePayload(
        { kind: 'buttons', body: 'Pick', buttons: makeButtons(11) },
        'telegram',
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/Telegram allows at most 10/i)
    })
    it('Telegram: malformed payload fails (empty body)', () => {
      const res = validateInteractivePayload(
        { kind: 'buttons', body: '', buttons: makeButtons(2) },
        'telegram',
      )
      expect(res.ok).toBe(false)
    })
    it('Telegram: malformed duplicate id fails', () => {
      const res = validateInteractivePayload(
        { kind: 'buttons', body: 'Pick', buttons: [{ id: 'dup', title: 'A' }, { id: 'dup', title: 'B' }] },
        'telegram',
      )
      expect(res.ok).toBe(false)
    })
    it('Telegram: payload with 5 buttons is NOT rejected by WhatsApp constraint when channel is telegram', () => {
      const tg = validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(5) }, 'telegram')
      const wa = validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(5) }, 'whatsapp')
      expect(tg.ok).toBe(true)
      expect(wa.ok).toBe(false)
      if (!wa.ok) expect(wa.error).toMatch(/WhatsApp allows at most 3/i)
    })
    it('WhatsApp: valid payload with 2 buttons succeeds', () => {
      expect(validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(2) }, 'whatsapp')).toEqual({ ok: true })
    })
    it('WhatsApp: 3 buttons succeeds (max)', () => {
      expect(validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(3) }, 'whatsapp').ok).toBe(true)
    })
    it('WhatsApp: 4 buttons fails with WhatsApp limit', () => {
      const res = validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(4) }, 'whatsapp')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/WhatsApp allows at most 3/i)
    })
    it('WhatsApp: malformed empty body fails', () => {
      expect(validateInteractivePayload({ kind: 'buttons', body: '', buttons: makeButtons(1) }, 'whatsapp').ok).toBe(false)
    })
    it('Telegram: callback_data >64 bytes fails', () => {
      const longId = 'x'.repeat(65)
      const res = validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: [{ id: longId, title: 'A' }] }, 'telegram')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/1-64 bytes/)
    })
    it('default channel is WhatsApp (stricter) — 5 buttons without channel param fails', () => {
      const res = validateInteractivePayload({ kind: 'buttons', body: 'Pick', buttons: makeButtons(5) })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/WhatsApp allows at most 3/i)
    })
  })

  describe('validateStepsForActivation — channel aware', () => {
    it('Telegram: send_buttons with 10 buttons succeeds', () => {
      const issues = validateStepsForActivation([
        { step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(10), channel_target: 'telegram' } },
      ])
      expect(issues).toEqual([])
    })
    it('Telegram: 11 buttons fails', () => {
      const issues = validateStepsForActivation([
        { step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(11), channel_target: 'telegram' } },
      ])
      expect(issues.map((i) => i.path)).toContain('steps[0].interactive')
      expect(issues[0].message).toMatch(/Telegram allows at most 10/i)
    })
    it('WhatsApp: 3 succeeds, 4 fails', () => {
      expect(
        validateStepsForActivation([{ step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(3), channel_target: 'whatsapp' } }]),
      ).toEqual([])
      const four = validateStepsForActivation([{ step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(4), channel_target: 'whatsapp' } }])
      expect(four.length).toBeGreaterThan(0)
      expect(four[0].message).toMatch(/WhatsApp allows at most 3/i)
    })
    it('Current is treated as WhatsApp (stricter) — 5 buttons with current fails', () => {
      const issues = validateStepsForActivation([
        { step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(5), channel_target: 'current' } },
      ])
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0].message).toMatch(/WhatsApp allows at most 3/i)
    })
    it('same logical automation behaves per channel — 5 buttons telegram passes, whatsapp fails', () => {
      const base = { kind: 'buttons', body: 'Pick', buttons: makeButtons(5) }
      const tg = validateStepsForActivation([{ step_type: 'send_buttons', step_config: { ...base, channel_target: 'telegram' } }])
      const wa = validateStepsForActivation([{ step_type: 'send_buttons', step_config: { ...base, channel_target: 'whatsapp' } }])
      expect(tg).toEqual([])
      expect(wa.length).toBeGreaterThan(0)
    })
    it('channel_target is required — missing fails, no silent fallback', () => {
      const issues = validateStepsForActivation([
        { step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Pick', buttons: makeButtons(1) } as unknown as Record<string, unknown> },
      ])
      expect(issues.some((i) => i.path.includes('channel_target'))).toBe(true)
    })
    it('channel_target preserved — telegram stays telegram after validation', () => {
      const cfg = { kind: 'buttons', body: 'Pick', buttons: makeButtons(2), channel_target: 'telegram' }
      const issues = validateStepsForActivation([{ step_type: 'send_buttons', step_config: cfg as unknown as Record<string, unknown> }])
      expect(issues).toEqual([])
      // config still has telegram
      expect(cfg.channel_target).toBe('telegram')
    })
  })

  describe('validateFlowForActivation — channel aware', () => {
    const baseFlow = { name: 'Test', trigger_type: 'keyword' as const, trigger_config: { keywords: ['hi'] }, entry_node_id: 'start' }
    const start = { node_key: 'start', node_type: 'start', config: { next_node_key: 'btns' } }
    const end = { node_key: 'end', node_type: 'end', config: {} }

    it('Telegram: send_buttons with 10 buttons succeeds', () => {
      const btns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', channel_target: 'telegram', buttons: makeButtons(10).map((b, i) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } }
      const issues = validateFlowForActivation(baseFlow, [start as never, btns as never, end as never])
      const btnIssues = issues.filter((i) => i.node_key === 'btns' && i.field === 'buttons')
      expect(btnIssues).toEqual([])
    })
    it('Telegram: 11 buttons fails with Telegram message', () => {
      const btns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', channel_target: 'telegram', buttons: makeButtons(11).map((b, i) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } }
      const issues = validateFlowForActivation(baseFlow, [start as never, btns as never, end as never])
      const btnIssues = issues.filter((i) => i.node_key === 'btns' && i.field === 'buttons')
      expect(btnIssues.length).toBeGreaterThan(0)
      expect(btnIssues[0].message).toMatch(/Telegram allows at most 10/i)
    })
    it('WhatsApp: 3 succeeds, 4 fails', () => {
      const okBtns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', channel_target: 'whatsapp', buttons: makeButtons(3).map((b) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } }
      const okIssues = validateFlowForActivation(baseFlow, [start as never, okBtns as never, end as never])
      expect(okIssues.filter((i) => i.node_key === 'btns' && i.field === 'buttons')).toEqual([])

      const badBtns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', channel_target: 'whatsapp', buttons: makeButtons(4).map((b) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } }
      const badIssues = validateFlowForActivation(baseFlow, [start as never, badBtns as never, end as never])
      expect(badIssues.filter((i) => i.node_key === 'btns' && i.field === 'buttons').length).toBeGreaterThan(0)
      expect(badIssues.find((i) => i.node_key === 'btns' && i.field === 'buttons')?.message).toMatch(/WhatsApp allows at most 3/i)
    })
    it('Current treated as WhatsApp — 5 buttons with current fails', () => {
      const btns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', channel_target: 'current', buttons: makeButtons(5).map((b) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } }
      const issues = validateFlowForActivation(baseFlow, [start as never, btns as never, end as never])
      expect(issues.some((i) => i.node_key === 'btns' && i.field === 'buttons')).toBe(true)
    })
    it('channel_target preserved and no silent fallback — missing still requires field', () => {
      const btns = { node_key: 'btns', node_type: 'send_buttons', config: { text: 'Pick', buttons: makeButtons(2).map((b) => ({ reply_id: b.id, title: b.title, next_node_key: 'end' })) } as unknown as Record<string, unknown> }
      const issues = validateFlowForActivation(baseFlow, [start as never, btns as never, end as never])
      expect(issues.some((i) => i.node_key === 'btns' && i.field === 'channel_target')).toBe(true)
    })
  })
})
