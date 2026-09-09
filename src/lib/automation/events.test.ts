import { describe, expect, it } from 'vitest';

import { enqueueDomainEvent } from './events';
import { createMemoryStore } from './memory-store';

describe('domain event outbox', () => {
  it('returns the existing row for a duplicate idempotency key', async () => {
    const store = createMemoryStore();
    const first = await enqueueDomainEvent(store, {
      accountId: 'acct-1',
      eventType: 'tag_added',
      contactId: 'c1',
      payload: { tag_id: 't1' },
      idempotencyKey: 'same-key',
    });
    const second = await enqueueDomainEvent(store, {
      accountId: 'acct-1',
      eventType: 'tag_added',
      contactId: 'c1',
      payload: { tag_id: 't1' },
      idempotencyKey: 'same-key',
    });
    expect(second.id).toBe(first.id);
  });
});
