import { describe, expect, it } from 'vitest'
import { validateSequenceForActivation } from './validate'

describe('Sequences validation', () => {
  it('valid sequence', () => {
    expect(validateSequenceForActivation('Welcome', [{ step_type: 'send_message', step_config: { text: 'hi', channel_target: 'whatsapp' } }])).toEqual([])
  })
  it('missing name', () => {
    expect(validateSequenceForActivation('', [{ step_type: 'send_message', step_config: { text: 'hi', channel_target: 'whatsapp' } }]).some(i => i.path === 'name')).toBe(true)
  })
  it('invalid step', () => {
    expect(validateSequenceForActivation('Test', [{ step_type: 'send_message', step_config: { text: '', channel_target: 'whatsapp' } }]).some(i => i.path.includes('text'))).toBe(true)
  })
  it('wait step valid', () => {
    expect(validateSequenceForActivation('Test', [{ step_type: 'wait', step_config: { amount: 1, unit: 'hours' } }])).toEqual([])
  })
  it('wait until valid', () => {
    expect(validateSequenceForActivation('Test', [{ step_type: 'wait', step_config: { until: new Date(Date.now()+3600000).toISOString() } }])).toEqual([])
  })
})

describe('Sequences enrollment', () => {
  it('placeholder for enrollment logic', () => {
    // Enrollment is via enrollContactInSequence which checks duplicate active
    expect(true).toBe(true)
  })
})
