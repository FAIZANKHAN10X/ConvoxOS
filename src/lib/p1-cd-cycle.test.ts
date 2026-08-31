import { describe, expect, it } from 'vitest'
import { validateStepsForActivation } from './automations/validate'

describe('P1-C condition multi-branch validation (automations)', () => {
  it('automations condition multi validation', () => {
    const ok = validateStepsForActivation([
      {
        step_type: 'condition',
        step_config: {
          conditions: [
            { subject: 'tag_presence', operand: 'tag1' },
            { subject: 'contact_field', operand: 'email', value: 'a@b.com' },
          ],
          match: 'any',
        },
        branches: { yes: [], no: [] },
      } as unknown as { step_type: string; step_config: Record<string, unknown> },
    ])
    expect(ok).toEqual([])
    const bad = validateStepsForActivation([
      {
        step_type: 'condition',
        step_config: { conditions: [{ subject: 'tag_presence', operand: '' }], match: 'all' },
        branches: { yes: [], no: [] },
      } as unknown as { step_type: string; step_config: Record<string, unknown> },
    ])
    expect(bad.some((i) => i.path.includes('conditions[0].operand'))).toBe(true)
  })
})

describe('P1-D wait variants (automations)', () => {
  it('automations wait until validation', () => {
    expect(validateStepsForActivation([{ step_type: 'wait', step_config: { until: new Date(Date.now() + 3600000).toISOString() } }])).toEqual([])
    expect(validateStepsForActivation([{ step_type: 'wait', step_config: { until: 'bad' } }]).some((i) => i.path.includes('until'))).toBe(true)
    expect(validateStepsForActivation([{ step_type: 'wait', step_config: { amount: 1, unit: 'hours' } }])).toEqual([])
  })
})

describe('P1-E cycle guard deferred for flows in this P2 partial', () => {
  it('placeholder', () => {
    expect(true).toBe(true)
  })
})
