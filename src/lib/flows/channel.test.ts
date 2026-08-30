import { describe, it, expect } from 'vitest';
import { resolveChannelTarget, triggerChannelMatches } from './engine';
import type { FlowChannel } from './types';

describe('resolveChannelTarget (legacy compat)', () => {
  it('legacy missing → whatsapp (preserve WhatsApp flows)', () => {
    expect(resolveChannelTarget(undefined, 'telegram')).toBe('whatsapp');
    expect(resolveChannelTarget(null, 'telegram')).toBe('whatsapp');
    expect(resolveChannelTarget(undefined, null)).toBe('whatsapp');
  });
  it('new current from WhatsApp → WhatsApp', () => {
    expect(resolveChannelTarget('current', 'whatsapp' as FlowChannel)).toBe('whatsapp');
  });
  it('new current from Telegram → Telegram', () => {
    expect(resolveChannelTarget('current', 'telegram' as FlowChannel)).toBe('telegram');
  });
  it('explicit WhatsApp → WhatsApp', () => {
    expect(resolveChannelTarget('whatsapp', 'telegram' as FlowChannel)).toBe('whatsapp');
  });
  it('explicit Telegram → Telegram', () => {
    expect(resolveChannelTarget('telegram', 'whatsapp' as FlowChannel)).toBe('telegram');
  });
  it('current with no context → null (deterministic failure)', () => {
    expect(resolveChannelTarget('current', null)).toBeNull();
    expect(resolveChannelTarget('current', undefined)).toBeNull();
  });
  it('Telegram Flow no longer falls into WhatsApp sender (explicit telegram)', () => {
    // Explicit telegram should not become whatsapp
    expect(resolveChannelTarget('telegram', null)).toBe('telegram');
  });
});

describe('triggerChannelMatches', () => {
  it('any or absent → matches any channel', () => {
    expect(triggerChannelMatches(null, 'telegram' as FlowChannel)).toBe(true);
    expect(triggerChannelMatches({}, 'whatsapp' as FlowChannel)).toBe(true);
    expect(triggerChannelMatches({ channel: 'any' }, 'telegram' as FlowChannel)).toBe(true);
    expect(triggerChannelMatches({ channel: 'any' }, null)).toBe(true);
  });
  it('filters applicable triggers', () => {
    expect(triggerChannelMatches({ channel: 'telegram' }, 'telegram' as FlowChannel)).toBe(true);
    expect(triggerChannelMatches({ channel: 'whatsapp' }, 'telegram' as FlowChannel)).toBe(false);
    expect(triggerChannelMatches({ channel: 'telegram' }, 'whatsapp' as FlowChannel)).toBe(false);
  });
  it('non-conversational trigger with no channel still matches (channel filter ignored)', () => {
    // inboundChannel null → allow (tag/time triggers have no channel)
    expect(triggerChannelMatches({ channel: 'whatsapp' }, null)).toBe(true);
  });
});

describe('channel socket dispatch contract (existing)', () => {
  it('resolveChannelTarget covers cross-channel case Telegram→WhatsApp', () => {
    // Telegram trigger, explicit whatsapp send → socket gets whatsapp
    expect(resolveChannelTarget('whatsapp', 'telegram' as FlowChannel)).toBe('whatsapp');
  });
});
