import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  emitOverdue: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.admin,
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitTaskOverdue: mocks.emitOverdue,
}));

import { sweepOverdueTasks } from './overdue';

function mockDb(tasks: Array<Record<string, unknown>>) {
  return {
    tasks,
    from(table: string) {
      if (table !== 'tasks') throw new Error(`unexpected table ${table}`);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        not: () => builder,
        lt: () => builder,
        limit: () => builder,
        update: (patch: Record<string, unknown>) => {
          Object.assign(tasks[0] ?? {}, patch);
          return builder;
        },
      };
      // select-chain resolves to the seeded rows; update-chain is fire-and-forget.
      (builder as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown
      ) => resolve({ data: tasks, error: null });
      return builder;
    },
  };
}

beforeEach(() => {
  mocks.admin.mockReset();
  mocks.emitOverdue.mockReset();
  mocks.emitOverdue.mockResolvedValue(undefined);
});

describe('sweepOverdueTasks', () => {
  it('emits once per overdue task and marks it fired', async () => {
    const tasks: Array<Record<string, unknown>> = [
      {
        id: 'task-1',
        account_id: 'acct-1',
        contact_id: 'contact-1',
        title: 'Call back',
        due_at: '2025-01-01T00:00:00.000Z',
      },
    ];
    const db = mockDb(tasks);
    mocks.admin.mockReturnValue(db);

    const fired = await sweepOverdueTasks(new Date('2026-01-01T00:00:00.000Z'));

    expect(fired).toBe(1);
    expect(mocks.emitOverdue).toHaveBeenCalledTimes(1);
    expect(mocks.emitOverdue).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
      })
    );
    expect(tasks[0].overdue_fired_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns zero when nothing is due', async () => {
    const db = mockDb([]);
    mocks.admin.mockReturnValue(db);

    const fired = await sweepOverdueTasks(new Date('2026-01-01T00:00:00.000Z'));

    expect(fired).toBe(0);
    expect(mocks.emitOverdue).not.toHaveBeenCalled();
  });
});
