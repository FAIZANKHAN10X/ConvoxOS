import { describe, expect, it } from 'vitest'
import { validateFlowForActivation } from './validate'
import { waitMsForFlow } from './engine'

const baseFlow = { name: 'Test', trigger_type: 'keyword' as const, trigger_config: { keywords: ['hi'] }, entry_node_id: 'start' }
const start = { node_key: 'start', node_type: 'start', config: { next_node_key: 'w' } }
const end = { node_key: 'end', node_type: 'end', config: {} }

describe('Flow Wait P1', () => {
  it('duration wait valid', () => {
    const w = { node_key: 'w', node_type: 'wait', config: { amount: 5, unit: 'hours', next_node_key: 'end' } }
    expect(validateFlowForActivation(baseFlow, [start as never, w as never, end as never]).filter(i => i.node_key === 'w' && i.severity === 'error')).toEqual([])
    expect(waitMsForFlow({ amount: 1, unit: 'minutes' })).toBe(60000)
  })
  it('until ISO wait valid and takes precedence', () => {
    const future = new Date(Date.now() + 3600000).toISOString()
    const w = { node_key: 'w', node_type: 'wait', config: { until: future, next_node_key: 'end' } }
    expect(validateFlowForActivation(baseFlow, [start as never, w as never, end as never]).filter(i => i.node_key === 'w')).toEqual([])
    const ms = waitMsForFlow({ until: future })
    expect(ms).toBeGreaterThan(3590000)
  })
  it('past until returns min 1000', () => {
    const past = new Date(Date.now() - 100000).toISOString()
    expect(waitMsForFlow({ until: past })).toBe(1000)
  })
  it('invalid duration and invalid ISO', () => {
    const badAmount = { node_key: 'w', node_type: 'wait', config: { amount: 0, unit: 'hours', next_node_key: 'end' } }
    expect(validateFlowForActivation(baseFlow, [start as never, badAmount as never, end as never]).some(i => i.field === 'amount')).toBe(true)
    const badUntil = { node_key: 'w', node_type: 'wait', config: { until: 'not-a-date', next_node_key: 'end' } }
    expect(validateFlowForActivation(baseFlow, [start as never, badUntil as never, end as never]).some(i => i.field === 'until')).toBe(true)
    const missingBoth = { node_key: 'w', node_type: 'wait', config: { next_node_key: 'end' } }
    expect(validateFlowForActivation(baseFlow, [start as never, missingBoth as never, end as never]).some(i => i.field === 'amount')).toBe(true)
  })
})

describe('Flow Conditions P1', () => {
  it('single legacy condition true/false', () => {
    const c = { node_key: 'c', node_type: 'condition', config: { subject: 'var', subject_key: 'x', operator: 'present', true_next: 'end', false_next: 'end' } }
    expect(validateFlowForActivation({ ...baseFlow, entry_node_id: 'c' }, [c as never, end as never]).filter(i => i.severity === 'error')).toEqual([])
  })
  it('multi ALL and ANY', () => {
    const all = {
      node_key: 'c',
      node_type: 'condition',
      config: {
        conditions: [
          { subject: 'var', subject_key: 'x', operator: 'present' },
          { subject: 'tag', subject_key: 'tag1', operator: 'present' },
        ],
        match: 'all',
        true_next: 'end',
        false_next: 'end',
      },
    }
    expect(validateFlowForActivation({ ...baseFlow, entry_node_id: 'c' }, [all as never, end as never]).filter(i => i.severity === 'error')).toEqual([])
    const any = { node_key: 'c', node_type: 'condition', config: { conditions: [{ subject: 'var', subject_key: 'x', operator: 'present' }], match: 'any', true_next: 'end', false_next: 'end' } }
    expect(validateFlowForActivation({ ...baseFlow, entry_node_id: 'c' }, [any as never, end as never]).filter(i => i.severity === 'error')).toEqual([])
    const badMatch = { node_key: 'c', node_type: 'condition', config: { conditions: [{ subject: 'var', subject_key: 'x', operator: 'present' }], match: 'bad', true_next: 'end', false_next: 'end' } }
    expect(validateFlowForActivation({ ...baseFlow, entry_node_id: 'c' }, [badMatch as never, end as never]).some(i => i.field === 'match')).toBe(true)
  })
  it('missing value warning and null handling', () => {
    const missing = { node_key: 'c', node_type: 'condition', config: { subject: 'var', subject_key: 'x', operator: 'equals', value: '', true_next: 'end', false_next: 'end' } }
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'c' }, [missing as never, end as never])
    expect(issues.some(i => i.severity === 'warning' && i.field === 'value')).toBe(true)
  })
})

describe('Flow Cycle Guard P1', () => {
  it('direct cycle a→b→a', () => {
    const nodes = [
      { node_key: 'a', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'b' } },
      { node_key: 'b', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'a' } },
    ]
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'a' }, nodes as never)
    expect(issues.some(i => i.message.includes('Cycle detected'))).toBe(true)
  })
  it('indirect cycle a→b→c→b', () => {
    const nodes = [
      { node_key: 'a', node_type: 'start', config: { next_node_key: 'b' } },
      { node_key: 'b', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'c' } },
      { node_key: 'c', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'b' } },
    ]
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'a' }, nodes as never)
    expect(issues.some(i => i.message.includes('Cycle detected'))).toBe(true)
  })
  it('self-cycle', () => {
    const nodes = [{ node_key: 'a', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'a' } }]
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'a' }, nodes as never)
    expect(issues.some(i => i.message.includes('Cycle detected'))).toBe(true)
  })
  it('acyclic passes', () => {
    const nodes = [
      { node_key: 'a', node_type: 'start', config: { next_node_key: 'b' } },
      { node_key: 'b', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'c' } },
      { node_key: 'c', node_type: 'end', config: {} },
    ]
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'a' }, nodes as never)
    expect(issues.some(i => i.message.includes('Cycle'))).toBe(false)
  })
  it('dangling edge still flagged', () => {
    const nodes = [
      { node_key: 'a', node_type: 'send_message', config: { text: 'hi', channel_target: 'whatsapp', next_node_key: 'missing' } },
      { node_key: 'b', node_type: 'end', config: {} },
    ]
    const issues = validateFlowForActivation({ ...baseFlow, entry_node_id: 'a' }, nodes as never)
    expect(issues.some(i => i.field === 'next_node_key')).toBe(true)
  })
})
