import { describe, expect, it } from 'vitest';

import { findSentMessage, messageBlockKey } from './idempotency';

function chain(result: { data: unknown; error: null }) {
  return {
    select: () => chain(result),
    eq: () => chain(result),
    maybeSingle: async () => result,
  };
}

function fakeDb(row: Record<string, unknown> | null) {
  return {
    from: () => chain({ data: row, error: null }),
  } as never;
}

describe('message send idempotency', () => {
  it('derives stable per-block keys independent of attempt', () => {
    expect(messageBlockKey('run-1', 'node-a', 'blk-1')).toBe(
      messageBlockKey('run-1', 'node-a', 'blk-1')
    );
    expect(messageBlockKey('run-1', 'node-a', 'blk-1')).not.toBe(
      messageBlockKey('run-1', 'node-a', 'blk-2')
    );
    expect(messageBlockKey('run-1', 'node-a', 'blk-1')).not.toBe(
      messageBlockKey('run-2', 'node-a', 'blk-1')
    );
  });

  it('returns the persisted row on a retry hit', async () => {
    const hit = await findSentMessage(
      fakeDb({ id: 'msg-9', message_id: 'wamid:9' }),
      'conv-1',
      'run-1:node-a:blk-1'
    );
    expect(hit).toEqual({ messageId: 'msg-9', providerMessageId: 'wamid:9' });
  });

  it('returns null when nothing was persisted yet', async () => {
    expect(await findSentMessage(fakeDb(null), 'conv-1', 'k')).toBeNull();
  });

  it('tolerates a missing provider id', async () => {
    const hit = await findSentMessage(
      fakeDb({ id: 'msg-9', message_id: null }),
      'conv-1',
      'k'
    );
    expect(hit).toEqual({ messageId: 'msg-9', providerMessageId: '' });
  });
});
