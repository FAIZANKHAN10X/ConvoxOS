import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  created: vi.fn(),
  completed: vi.fn(),
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitTaskCreated: mocks.created,
  emitTaskCompleted: mocks.completed,
}));

import { completeTask, createTask, TaskWriteError } from './write';

function taskDb(options: {
  insert?: { data: unknown; error: { message: string } | null };
  existing?: { data: unknown; error: { message: string } | null };
  update?: { data: unknown; error: { message: string } | null };
}) {
  return {
    from() {
      const builder = {
        insert() {
          return builder;
        },
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        update() {
          return builder;
        },
        single() {
          if (options.insert) return Promise.resolve(options.insert);
          if (options.update) return Promise.resolve(options.update);
          return Promise.resolve({ data: null, error: { message: 'no' } });
        },
        maybeSingle() {
          return Promise.resolve(
            options.existing ?? { data: null, error: null }
          );
        },
      };
      return builder;
    },
  } as never;
}

const row = {
  id: 'task-1',
  account_id: 'acct-1',
  contact_id: 'contact-1',
  title: 'Follow up',
  status: 'open',
};

beforeEach(() => {
  mocks.created.mockReset();
  mocks.completed.mockReset();
  mocks.created.mockResolvedValue(undefined);
  mocks.completed.mockResolvedValue(undefined);
});

describe('createTask', () => {
  it('inserts then emits task_created for contact-scoped tasks', async () => {
    const created = await createTask(
      taskDb({ insert: { data: row, error: null } }),
      {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
        title: 'Follow up',
      }
    );
    expect(created.id).toBe('task-1');
    expect(mocks.created).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        idempotencyKey: 'task_created:task-1',
      })
    );
  });

  it('rejects a blank title', async () => {
    await expect(
      createTask(taskDb({}), {
        accountId: 'acct-1',
        userId: 'user-1',
        title: '   ',
      })
    ).rejects.toBeInstanceOf(TaskWriteError);
    expect(mocks.created).not.toHaveBeenCalled();
  });
});

describe('completeTask', () => {
  it('is a no-op when already completed', async () => {
    const result = await completeTask(
      taskDb({
        existing: { data: { ...row, status: 'completed' }, error: null },
      }),
      { accountId: 'acct-1', taskId: 'task-1' }
    );
    expect(result.completed).toBe(false);
    expect(mocks.completed).not.toHaveBeenCalled();
  });

  it('emits task_completed when status flips', async () => {
    const result = await completeTask(
      taskDb({
        existing: { data: row, error: null },
        update: { data: { ...row, status: 'completed' }, error: null },
      }),
      { accountId: 'acct-1', taskId: 'task-1' }
    );
    expect(result.completed).toBe(true);
    expect(mocks.completed).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'task_completed:task-1',
      })
    );
  });
});
