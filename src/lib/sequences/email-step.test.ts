import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateSequenceForActivation } from './validate';

type Row = Record<string, unknown>;

const state = {
  enrollments: [] as Row[],
  steps: [] as Row[],
  conversations: [] as Row[],
  sequences: [] as Row[],
};

const dispatched: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => fakeDb(),
}));

vi.mock('@/lib/channels/socket', () => ({
  dispatchText: vi.fn(async (args: unknown) => {
    dispatched.push(args as Record<string, unknown>);
    return { providerMessageId: 'p:1', messageId: 'm:1' };
  }),
}));

function fakeDb() {
  const table = (name: string): Row[] => {
    if (name === 'sequence_enrollments') return state.enrollments;
    if (name === 'sequence_steps') return state.steps;
    if (name === 'conversations') return state.conversations;
    if (name === 'sequences') return state.sequences;
    throw new Error(`unexpected table ${name}`);
  };
  const builder = (name: string) => {
    const filters: Array<{ col: string; val: unknown }> = [];
    let patch: Row | null = null;
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return api;
    };
    api.order = () => api;
    api.limit = () => api;
    api.update = (p: Row) => {
      patch = p;
      return api;
    };
    const run = () => {
      const out = table(name).filter((r) =>
        filters.every(({ col, val }) => r[col] === val)
      );
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
    api.then = (resolve: (v: unknown) => unknown) => resolve(run());
    return api;
  };
  return { from: (name: string) => builder(name) };
}

import { runSequenceEnrollment } from './engine';

beforeEach(() => {
  state.enrollments.length = 0;
  state.steps.length = 0;
  state.conversations.length = 0;
  state.sequences.length = 0;
  dispatched.length = 0;
  state.enrollments.push({
    id: 'enr-email',
    sequence_id: 'seq-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    status: 'active',
    current_position: 0,
    next_run_at: null,
  });
  state.sequences.push({ id: 'seq-1', account_id: 'acct-1' });
  state.conversations.push({ id: 'conv-1', account_id: 'acct-1', contact_id: 'contact-1' });
  state.steps.push({
    id: 'step-1',
    sequence_id: 'seq-1',
    position: 0,
    step_type: 'send_email',
    step_config: { subject: 'Drip 1', text: 'Hello from the drip' },
  });
});

describe('send_email sequence steps', () => {
  it('validates subject and body', () => {
    expect(
      validateSequenceForActivation('Drip', [
        { step_type: 'send_email', step_config: { subject: 'Hi', text: 'Hello' } },
      ])
    ).toEqual([]);
    const issues = validateSequenceForActivation('Drip', [
      { step_type: 'send_email', step_config: { text: 'Hello' } },
    ]);
    expect(issues.some((i) => i.path.includes('subject'))).toBe(true);
  });

  it('sends through the email channel with the step subject', async () => {
    await runSequenceEnrollment('enr-email');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      channel: 'email',
      subject: 'Drip 1',
      text: 'Hello from the drip',
    });
    const enrollment = state.enrollments[0];
    expect(enrollment.status).toBe('completed');
  });
});
