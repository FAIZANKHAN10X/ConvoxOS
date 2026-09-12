import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = {
  enrollments: [] as Row[],
  steps: [] as Row[],
  conversations: [] as Row[],
  sequences: [] as Row[],
  failDispatch: false,
};

const dispatched: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => fakeDb(),
}));

vi.mock('@/lib/channels/socket', () => ({
  dispatchText: vi.fn(async (args: unknown) => {
    dispatched.push(args as Record<string, unknown>);
    if (state.failDispatch) throw new Error('provider down');
    return { providerMessageId: 'p:1', messageId: 'm:1' };
  }),
}));

function matches(row: Row, filters: Array<{ col: string; op: string; val: unknown }>): boolean {
  return filters.every(({ col, op, val }) => {
    const v = row[col];
    if (op === 'eq') return v === val;
    if (op === 'lte') return (v as string) <= (val as string);
    if (op === 'in') return (val as unknown[]).includes(v);
    return false;
  });
}

function fakeDb() {
  const table = (name: string): Row[] => {
    if (name === 'sequence_enrollments') return state.enrollments;
    if (name === 'sequence_steps') return state.steps;
    if (name === 'conversations') return state.conversations;
    if (name === 'sequences') return state.sequences;
    throw new Error(`unexpected table ${name}`);
  };
  const builder = (name: string) => {
    const filters: Array<{ col: string; op: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let limitN: number | null = null;
    let patch: Row | null = null;
    let insertRow: Row | null = null;
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, op: 'eq', val });
      return api;
    };
    api.lte = (col: string, val: unknown) => {
      filters.push({ col, op: 'lte', val });
      return api;
    };
    api.in = (col: string, val: unknown) => {
      filters.push({ col, op: 'in', val });
      return api;
    };
    api.order = (col: string) => {
      orderCol = col;
      return api;
    };
    api.limit = (n: number) => {
      limitN = n;
      return api;
    };
    api.update = (p: Row) => {
      patch = p;
      return api;
    };
    api.insert = (r: Row) => {
      insertRow = r;
      return api;
    };
    const run = () => {
      const rows = table(name);
      if (insertRow) {
        const row = { id: `id-${rows.length + 1}`, ...insertRow };
        rows.push(row);
        return { data: row, error: null };
      }
      let out = rows.filter((r) => matches(r, filters));
      if (orderCol) out = [...out].sort((a, b) => String(a[orderCol as string]).localeCompare(String(b[orderCol as string])));
      if (limitN !== null) out = out.slice(0, limitN);
      if (patch) {
        for (const r of out) Object.assign(r, patch);
        return { data: out, error: null };
      }
      return { data: out, error: null };
    };
    api.maybeSingle = async () => {
      const { data } = run() as { data: Row[] };
      return { data: data[0] ?? null, error: null };
    };
    api.single = async () => {
      const { data } = run() as { data: Row[] | Row };
      return { data: (Array.isArray(data) ? data[0] : data) ?? null, error: null };
    };
    api.then = (resolve: (v: unknown) => unknown) => resolve(run());
    return api;
  };
  return {
    from: (name: string) => builder(name),
    rpc: async (fn: string, args: { p_limit: number; p_lease_seconds: number }) => {
      if (fn !== 'claim_due_sequence_enrollments') throw new Error(`unexpected rpc ${fn}`);
      const now = new Date().toISOString();
      const due = state.enrollments
        .filter((r) => r.status === 'active' && (r.next_run_at as string) <= now)
        .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))
        .slice(0, args.p_limit);
      // Lease-bump claim: mirrors the SQL RPC semantics.
      for (const r of due) {
        r.next_run_at = new Date(Date.now() + args.p_lease_seconds * 1000).toISOString();
      }
      return { data: due, error: null };
    },
  };
}

import { dispatchText } from '@/lib/channels/socket';
import {
  cancelSequenceEnrollment,
  enrollContactInSequence,
  resumeDueSequenceEnrollments,
  runSequenceEnrollment,
} from './engine';

const mockedDispatch = vi.mocked(dispatchText);

function seed(opts: {
  enrollmentId?: string;
  accountId?: string;
  position?: number;
  status?: string;
  nextRunAt?: string;
  steps?: Array<{ step_type: string; step_config: Record<string, unknown> }>;
  conversationId?: string;
  withSteps?: boolean;
}) {
  const enrollmentId = opts.enrollmentId ?? 'enr-1';
  state.enrollments.push({
    id: enrollmentId,
    sequence_id: 'seq-1',
    account_id: opts.accountId ?? 'acct-1',
    contact_id: 'contact-1',
    status: opts.status ?? 'active',
    current_position: opts.position ?? 0,
    next_run_at: opts.nextRunAt ?? new Date(Date.now() - 60_000).toISOString(),
  });
  const steps = opts.steps ?? [{ step_type: 'send_message', step_config: { text: 'hello', channel_target: 'whatsapp' } }];
  if (opts.withSteps !== false) {
    steps.forEach((s, i) =>
      state.steps.push({ id: `step-${state.steps.length}`, sequence_id: 'seq-1', position: i, ...s })
    );
  }
  state.conversations.push({
    id: opts.conversationId ?? 'conv-1',
    account_id: opts.accountId ?? 'acct-1',
    contact_id: 'contact-1',
  });
  return enrollmentId;
}

beforeEach(() => {
  state.enrollments = [];
  state.steps = [];
  state.conversations = [];
  state.sequences = [{ id: 'seq-1', account_id: 'acct-1' }, { id: 'seq-1', account_id: 'acct-a' }, { id: 'seq-1', account_id: 'acct-b' }];
  state.failDispatch = false;
  dispatched.length = 0;
  mockedDispatch.mockClear();
});

describe('T4.1 sequence scheduler', () => {
  it('1. discovers a due enrollment and executes its step', async () => {
    seed({});
    const n = await resumeDueSequenceEnrollments();
    expect(n).toBe(1);
    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    expect(mockedDispatch.mock.calls[0][0]).toMatchObject({ text: 'hello' });
  });

  it('2. ignores future-scheduled enrollments', async () => {
    seed({ enrollmentId: 'enr-future', nextRunAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('3. claimed step executes through the channel socket', async () => {
    seed({});
    await resumeDueSequenceEnrollments();
    const call = mockedDispatch.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(call.accountId).toBe('acct-1');
    expect(call.conversationId).toBe('conv-1');
  });

  it('4. successful send advances position and schedules next', async () => {
    seed({
      steps: [
        { step_type: 'send_message', step_config: { text: 'one', channel_target: 'whatsapp' } },
        { step_type: 'send_message', step_config: { text: 'two', channel_target: 'whatsapp' } },
      ],
    });
    await resumeDueSequenceEnrollments();
    // Both immediate sends run in one invocation (tail recursion)
    expect(mockedDispatch).toHaveBeenCalledTimes(2);
    const enr = state.enrollments[0];
    expect(enr.current_position).toBe(2);
    expect(enr.status).toBe('completed');
  });

  it('5. final step completes the enrollment', async () => {
    seed({});
    await resumeDueSequenceEnrollments();
    const enr = state.enrollments[0];
    expect(enr.status).toBe('completed');
    expect(enr.completed_at).toBeTruthy();
  });

  it('6. failed send cancels explicitly without advancing', async () => {
    state.failDispatch = true;
    seed({});
    await resumeDueSequenceEnrollments();
    const enr = state.enrollments[0];
    expect(enr.status).toBe('cancelled');
    expect(enr.current_position).toBe(0);
    expect(enr.completed_at).toBeFalsy();
  });

  it('7. duplicate sweep cannot re-execute the same step', async () => {
    seed({});
    expect(await resumeDueSequenceEnrollments()).toBe(1);
    // Second tick: lease-bump moved next_run_at to the future (and the
    // enrollment completed) — nothing due.
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    expect(mockedDispatch).toHaveBeenCalledTimes(1);
  });

  it('8. concurrent execution is safe: stable idempotency key per step', async () => {
    seed({ enrollmentId: 'enr-race' });
    // Two overlapping executors on the same position (claim race).
    await runSequenceEnrollment('enr-race');
    const firstKeys = dispatched.map((d) => d.idempotencyKey);
    dispatched.length = 0;
    // Reset to simulate the loser re-running the same position.
    state.enrollments[0].current_position = 0;
    state.enrollments[0].status = 'active';
    await runSequenceEnrollment('enr-race');
    const secondKeys = dispatched.map((d) => d.idempotencyKey);
    expect(firstKeys).toEqual(['seq:enr-race:0']);
    expect(secondKeys).toEqual(['seq:enr-race:0']);
  });

  it('9. account isolation: runs stay within their own account', async () => {
    seed({ enrollmentId: 'enr-a', accountId: 'acct-a', conversationId: 'conv-a' });
    seed({ enrollmentId: 'enr-b', accountId: 'acct-b', conversationId: 'conv-b', withSteps: false });
    await resumeDueSequenceEnrollments(50);
    expect(dispatched).toHaveLength(2);
    for (const d of dispatched) {
      const conv = state.conversations.find((c) => c.id === d.conversationId);
      // The resolved conversation always belongs to the dispatch account.
      expect(conv?.account_id).toBe(d.accountId);
    }
    const byAccount = new Map(dispatched.map((d) => [d.accountId, d.conversationId]));
    expect(byAccount.get('acct-a')).toBe('conv-a');
    expect(byAccount.get('acct-b')).toBe('conv-b');
  });

  it('10. wait steps park without sending and resume later', async () => {
    const id = seed({
      steps: [
        { step_type: 'wait', step_config: { amount: 1, unit: 'hours' } },
        { step_type: 'send_message', step_config: { text: 'after wait', channel_target: 'whatsapp' } },
      ],
    });
    await resumeDueSequenceEnrollments();
    expect(mockedDispatch).not.toHaveBeenCalled();
    const enr = state.enrollments.find((e) => e.id === id)!;
    expect(enr.current_position).toBe(1);
    expect(new Date(enr.next_run_at as string).getTime()).toBeGreaterThan(Date.now());
    // Sweep before due: nothing. Force due: send runs.
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    enr.next_run_at = new Date(Date.now() - 1000).toISOString();
    expect(await resumeDueSequenceEnrollments()).toBe(1);
    expect(mockedDispatch).toHaveBeenCalledTimes(1);
  });

  it('cancel + enroll helpers behave', async () => {
    const id = seed({});
    await cancelSequenceEnrollment(id, 'acct-1');
    expect(state.enrollments[0].status).toBe('cancelled');
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    // enrollContactInSequence dedupes active enrollments
    const res = await enrollContactInSequence({
      accountId: 'acct-1',
      sequenceId: 'seq-1',
      contactId: 'contact-1',
    });
    expect(res.enrollmentId).toBeTruthy();
  });
});

describe('T4.2 stop on reply', () => {
  it('1. inbound reply cancels the active enrollment with reason reply', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({});
    const stopped = await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' });
    expect(stopped).toBe(1);
    expect(state.enrollments[0].status).toBe('cancelled');
    expect(state.enrollments[0].cancelled_reason).toBe('reply');
  });

  it('2. cancelled enrollment executes no future steps', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({});
    await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' });
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('3. outbound sends never cancel: completed run has no reason', async () => {
    seed({});
    await resumeDueSequenceEnrollments();
    const enr = state.enrollments[0];
    expect(enr.status).toBe('completed');
    expect(enr.cancelled_reason ?? null).toBeNull();
  });

  it('4. completed enrollment is unaffected by reply', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({});
    await resumeDueSequenceEnrollments();
    const before = { ...state.enrollments[0] };
    expect(await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' })).toBe(0);
    expect(state.enrollments[0]).toEqual(before);
  });

  it('5. already-cancelled enrollment is unaffected by reply', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({});
    await cancelSequenceEnrollment('enr-1', 'acct-1');
    const cancelledAt = state.enrollments[0].cancelled_at;
    expect(await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' })).toBe(0);
    expect(state.enrollments[0].status).toBe('cancelled');
    expect(state.enrollments[0].cancelled_at).toBe(cancelledAt);
    expect(state.enrollments[0].cancelled_reason).toBe('manual');
  });

  it('6. duplicate reply is harmless', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({});
    expect(await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' })).toBe(1);
    expect(await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' })).toBe(0);
    expect(state.enrollments[0].status).toBe('cancelled');
  });

  it('7. account A reply cannot cancel account B enrollment', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({ enrollmentId: 'enr-b', accountId: 'acct-b', conversationId: 'conv-b', withSteps: false });
    // Same contact id, other account: enroll one there too
    state.enrollments.push({
      id: 'enr-a', sequence_id: 'seq-1', account_id: 'acct-a', contact_id: 'contact-1',
      status: 'active', current_position: 0,
      next_run_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await stopEnrollmentsOnReply({ accountId: 'acct-a', contactId: 'contact-1' })).toBe(1);
    expect(state.enrollments.find((e) => e.id === 'enr-b')?.status).toBe('active');
    expect(state.enrollments.find((e) => e.id === 'enr-a')?.status).toBe('cancelled');
  });

  it('8. claim/reply race: reply between claim and run prevents execution', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({ enrollmentId: 'enr-race2' });
    // Simulate a sweep claim landing first: lease bumped, still active.
    state.enrollments[0].next_run_at = new Date(Date.now() + 300_000).toISOString();
    // Reply lands before the executor's entry re-check.
    await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' });
    await runSequenceEnrollment('enr-race2');
    expect(mockedDispatch).not.toHaveBeenCalled();
    expect(state.enrollments[0].status).toBe('cancelled');
    expect(state.enrollments[0].cancelled_reason).toBe('reply');
  });

  it('9. waiting enrollment is cancelled and never resumes', async () => {
    const { stopEnrollmentsOnReply } = await import('./engine');
    seed({
      steps: [
        { step_type: 'wait', step_config: { amount: 1, unit: 'hours' } },
        { step_type: 'send_message', step_config: { text: 'later', channel_target: 'whatsapp' } },
      ],
    });
    await resumeDueSequenceEnrollments();
    expect(state.enrollments[0].status).toBe('active');
    expect(state.enrollments[0].current_position).toBe(1);
    await stopEnrollmentsOnReply({ accountId: 'acct-1', contactId: 'contact-1' });
    expect(state.enrollments[0].status).toBe('cancelled');
    // Even forced due, the cancelled enrollment stays silent.
    state.enrollments[0].next_run_at = new Date(Date.now() - 1000).toISOString();
    expect(await resumeDueSequenceEnrollments()).toBe(0);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('manual cancel defaults to reason manual', async () => {
    seed({});
    await cancelSequenceEnrollment('enr-1', 'acct-1');
    expect(state.enrollments[0].cancelled_reason).toBe('manual');
  });
});
