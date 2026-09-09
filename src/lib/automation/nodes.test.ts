import { describe, expect, it } from 'vitest';

import { tagAddedTrigger, waitNode } from './nodes';
import type { DomainEvent } from './types';

const TAG = '11111111-1111-1111-1111-111111111111';

function event(tagId: string): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: 'tag_added',
    contactId: 'c1',
    payload: { tag_id: tagId },
    source: 'crm',
    originRunId: null,
    causationEventId: null,
    chainDepth: 0,
    idempotencyKey: 'k',
    status: 'pending',
    attempts: 0,
    availableAt: new Date().toISOString(),
    processedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

describe('builtin nodes', () => {
  it('matches tag_added only for the configured tag', () => {
    expect(tagAddedTrigger.match?.(event(TAG), { tagId: TAG })).toBe(true);
    expect(
      tagAddedTrigger.match?.(event('33333333-3333-3333-3333-333333333333'), {
        tagId: TAG,
      })
    ).toBe(false);
  });

  it('computes wait resume times from amount and unit', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = waitNode.execute?.(
      {
        accountId: 'a',
        contactId: 'c',
        runId: 'r',
        automationId: 'u',
        versionId: 'v',
        event: event(TAG),
        vars: {},
        now,
        db: {},
      },
      { amount: 24, unit: 'hours' }
    );
    expect(result).toEqual({
      status: 'wait',
      waitUntil: '2026-01-02T00:00:00.000Z',
    });
  });
});
