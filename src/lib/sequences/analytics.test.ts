import { describe, expect, it, vi } from 'vitest';
import { loadSequenceAnalytics } from './analytics';

function mockDb(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    rpc: vi.fn(async () => ({ data: row ? [row] : [], error })),
  } as never;
}

const FULL = {
  enrolled: 10,
  active: 3,
  paused: 1,
  completed: 2,
  stopped: 3,
  failed: 1,
  sent: 25,
  replied: 2,
};

describe('loadSequenceAnalytics (T4.4)', () => {
  it('maps the full summary row', async () => {
    const db = mockDb(FULL);
    const a = await loadSequenceAnalytics(db, 'acct-1', 'seq-1');
    expect(a).toEqual(FULL);
  });

  it('returns zeros for an empty result (foreign or fresh sequence)', async () => {
    const db = mockDb(null);
    const a = await loadSequenceAnalytics(db, 'acct-1', 'seq-x');
    expect(a).toEqual({
      enrolled: 0,
      active: 0,
      paused: 0,
      completed: 0,
      stopped: 0,
      failed: 0,
      sent: 0,
      replied: 0,
    });
  });

  it('coerces numeric strings from PostgREST counts', async () => {
    const db = mockDb({ enrolled: '4', active: '1', paused: '0', completed: '1', stopped: '1', failed: '0', sent: '7', replied: '1' });
    const a = await loadSequenceAnalytics(db, 'acct-1', 'seq-1');
    expect(a.enrolled).toBe(4);
    expect(a.sent).toBe(7);
  });

  it('passes account + sequence scoping to the RPC', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await loadSequenceAnalytics({ rpc } as never, 'acct-9', 'seq-9');
    expect(rpc).toHaveBeenCalledWith('get_sequence_analytics', {
      p_account_id: 'acct-9',
      p_sequence_id: 'seq-9',
    });
  });

  it('surfaces RPC errors instead of zeros', async () => {
    const db = mockDb(null, { message: 'boom' });
    await expect(loadSequenceAnalytics(db, 'acct-1', 'seq-1')).rejects.toThrow(
      'sequence analytics: boom'
    );
  });
});
