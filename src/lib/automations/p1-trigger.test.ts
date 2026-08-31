import { describe, expect, it } from 'vitest'
import { validateTriggerForActivation } from './validate'
import { triggerMatches } from './engine'
import type { Automation } from '@/types'

function mkAutomation(type: string, config: Record<string, unknown>): Automation {
  return {
    id: 'a1',
    account_id: 'acct-1',
    user_id: 'u1',
    name: 'test',
    trigger_type: type as Automation['trigger_type'],
    trigger_config: config as unknown as Automation['trigger_config'],
    is_active: true,
    execution_count: 0,
    created_at: '',
    updated_at: '',
  }
}

describe('P1-A trigger validation', () => {
  it('contact_changed requires field', () => {
    expect(validateTriggerForActivation('contact_changed', {})).toEqual([{ path: 'trigger.field', message: 'field is required' }])
    expect(validateTriggerForActivation('contact_changed', { field: 'email' })).toEqual([])
    expect(validateTriggerForActivation('contact_changed', { field: 'email', value: 'a@b.com' })).toEqual([])
    expect(validateTriggerForActivation('contact_changed', { field: 'email', value: 123 as unknown as string }).map((i) => i.path)).toContain('trigger.value')
  })
  it('customer_replied channel validation', () => {
    expect(validateTriggerForActivation('customer_replied', { channel: 'whatsapp' })).toEqual([])
    expect(validateTriggerForActivation('customer_replied', { channel: 'telegram' })).toEqual([])
    expect(validateTriggerForActivation('customer_replied', { channel: 'any' })).toEqual([])
    expect(validateTriggerForActivation('customer_replied', { channel: 'bad' }).map((i) => i.path)).toContain('trigger.channel')
  })
  it('opportunity_created optional filters', () => {
    expect(validateTriggerForActivation('opportunity_created', {})).toEqual([])
    expect(validateTriggerForActivation('opportunity_created', { pipeline_id: 'p1', stage_id: 's1' })).toEqual([])
    expect(validateTriggerForActivation('opportunity_created', { pipeline_id: '' }).map((i) => i.path)).toContain('trigger.pipeline_id')
  })
  it('pipeline_stage_changed filters', () => {
    expect(validateTriggerForActivation('pipeline_stage_changed', {})).toEqual([])
    expect(validateTriggerForActivation('pipeline_stage_changed', { pipeline_id: 'p1', from_stage_id: 's1', to_stage_id: 's2' })).toEqual([])
    expect(validateTriggerForActivation('pipeline_stage_changed', { from_stage_id: '' }).map((i) => i.path)).toContain('trigger.from_stage_id')
  })
  it('inbound_webhook path optional', () => {
    expect(validateTriggerForActivation('inbound_webhook', {})).toEqual([])
    expect(validateTriggerForActivation('inbound_webhook', { path: '/hook' })).toEqual([])
    expect(validateTriggerForActivation('inbound_webhook', { path: 123 as unknown as string }).map((i) => i.path)).toContain('trigger.path')
  })
  it('note_added no required fields', () => {
    expect(validateTriggerForActivation('note_added', {})).toEqual([])
  })
})

describe('P1-A triggerMatches', () => {
  it('contact_changed matches field and optional value', () => {
    const a = mkAutomation('contact_changed', { field: 'email', value: 'a@b.com' })
    expect(triggerMatches(a, { contact_changed_field: 'email', contact_changed_value: 'a@b.com' })).toBe(true)
    expect(triggerMatches(a, { contact_changed_field: 'email', contact_changed_value: 'other' })).toBe(false)
    expect(triggerMatches(a, { contact_changed_field: 'name', contact_changed_value: 'a@b.com' })).toBe(false)
    const any = mkAutomation('contact_changed', { field: 'email' })
    expect(triggerMatches(any, { contact_changed_field: 'email', contact_changed_value: 'anything' })).toBe(true)
    expect(triggerMatches(any, { contact_changed_field: 'email' })).toBe(true)
    expect(triggerMatches(any, { contact_changed_field: 'phone' })).toBe(false)
  })
  it('note_added matches when note_id present', () => {
    const a = mkAutomation('note_added', {})
    expect(triggerMatches(a, { note_id: 'n1', note_text: 'hello' })).toBe(true)
    expect(triggerMatches(a, {})).toBe(false)
    expect(triggerMatches(a, undefined)).toBe(false)
  })
  it('customer_replied matches with channel filter', () => {
    const any = mkAutomation('customer_replied', { channel: 'any' })
    expect(triggerMatches(any, { message_text: 'hi', trigger_channel: 'whatsapp' })).toBe(true)
    expect(triggerMatches(any, { message_text: '' })).toBe(false)
    const wa = mkAutomation('customer_replied', { channel: 'whatsapp' })
    expect(triggerMatches(wa, { message_text: 'hi', trigger_channel: 'whatsapp' })).toBe(true)
    expect(triggerMatches(wa, { message_text: 'hi', trigger_channel: 'telegram' })).toBe(false)
    expect(triggerMatches(wa, { message_text: 'hi' })).toBe(false) // no channel when filter is specific -> false per spec
  })
  it('opportunity_created matches with pipeline/stage filters', () => {
    const a = mkAutomation('opportunity_created', { pipeline_id: 'p1', stage_id: 's1' })
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p1', stage_id: 's1' })).toBe(true)
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p1', stage_id: 's2' })).toBe(false)
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p2', stage_id: 's1' })).toBe(false)
    expect(triggerMatches(a, { pipeline_id: 'p1', stage_id: 's1' })).toBe(false) // no opportunity_id
    const any = mkAutomation('opportunity_created', {})
    expect(triggerMatches(any, { opportunity_id: 'o1' })).toBe(true)
  })
  it('pipeline_stage_changed matches with from/to', () => {
    const a = mkAutomation('pipeline_stage_changed', { pipeline_id: 'p1', from_stage_id: 's1', to_stage_id: 's2' })
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p1', from_stage_id: 's1', to_stage_id: 's2' })).toBe(true)
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p1', from_stage_id: 's1', to_stage_id: 's3' })).toBe(false)
    expect(triggerMatches(a, { opportunity_id: 'o1', pipeline_id: 'p1', from_stage_id: 's9', to_stage_id: 's2' })).toBe(false)
    const partial = mkAutomation('pipeline_stage_changed', { to_stage_id: 's2' })
    expect(triggerMatches(partial, { opportunity_id: 'o1', to_stage_id: 's2' })).toBe(true)
    expect(triggerMatches(partial, { opportunity_id: 'o1', to_stage_id: 's3' })).toBe(false)
  })
  it('inbound_webhook matches path filter', () => {
    const any = mkAutomation('inbound_webhook', {})
    expect(triggerMatches(any, { webhook_path: '/a', webhook_payload: {} })).toBe(true)
    const filtered = mkAutomation('inbound_webhook', { path: '/lead' })
    expect(triggerMatches(filtered, { webhook_path: '/lead' })).toBe(true)
    expect(triggerMatches(filtered, { webhook_path: '/other' })).toBe(false)
    expect(triggerMatches(filtered, {})).toBe(false) // no path? Actually inbound_webhook with path filter requires match, but if ctx has no webhook_path, the check cfg.path !== ctx.webhook_path -> false
  })
  it('preserves existing channel-aware trigger behavior for keyword_match', () => {
    const a = mkAutomation('keyword_match', { keywords: ['hi'], channel: 'whatsapp' } as unknown as Record<string, unknown>)
    expect(triggerMatches(a, { message_text: 'hi', trigger_channel: 'whatsapp' })).toBe(true)
    expect(triggerMatches(a, { message_text: 'hi', trigger_channel: 'telegram' })).toBe(false)
  })
})
