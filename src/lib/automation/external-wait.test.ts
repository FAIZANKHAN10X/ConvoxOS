import { describe, expect, it } from 'vitest';

import { extractRunCorrelation } from './external-wait';
import type { DomainEvent } from './types';

function event(payload: Record<string, unknown>): DomainEvent {
  return {
    id: 'e',
    accountId: 'a',
    eventType: 'external.received',
    contactId: 'c',
    payload,
    source: 'external',
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

describe('extractRunCorrelation', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('reads run_id from the webhook body', () => {
    expect(
      extractRunCorrelation(event({ body: { run_id: id, extra: 1 } }))
    ).toBe(id);
  });

  it('accepts correlation_id as the same identifier', () => {
    expect(
      extractRunCorrelation(event({ body: { correlation_id: id } }))
    ).toBe(id);
  });

  it('ignores non-uuid values', () => {
    expect(
      extractRunCorrelation(event({ body: { run_id: 'r:n1' } }))
    ).toBeNull();
  });
});
