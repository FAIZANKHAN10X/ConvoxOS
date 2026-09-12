import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createTask: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
}));

vi.mock('@/lib/tasks/write', () => ({
  createTask: mocks.createTask,
  completeTask: mocks.completeTask,
  TaskWriteError: class TaskWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.in = () => c;
  c.update = () => c;
  c.delete = () => c;
  c.maybeSingle = async () => result;
  return c;
}

function mockSupabase(tables: Record<string, unknown> = {}) {
  return {
    from: (table: string) => chain(tables[table] ?? { data: null, error: null }),
  };
}

import { DELETE as deleteTask, GET as getTask, PATCH as patchTask } from './route';
import { GET as listTasks, POST as createTaskRoute } from '../route';

const ctx = {
  supabase: mockSupabase(),
  accountId: 'acct-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'acct-1', name: 'Acme' },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.createTask.mockReset();
  mocks.completeTask.mockReset();
  mocks.requireRole.mockResolvedValue(ctx);
});

function req(method: string, body?: unknown, url = 'http://localhost/api/tasks') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'task-1' }) };

describe('POST /api/tasks', () => {
  it('creates via the domain writer (fires task_created)', async () => {
    mocks.createTask.mockResolvedValue({ id: 't1', title: 'Call back' });
    const scoped = {
      from: (table: string) => {
        if (table === 'contacts') {
          return chain({ data: { id: 'c1' }, error: null });
        }
        return chain({ data: null, error: null });
      },
    };
    mocks.requireRole.mockResolvedValueOnce({ ...ctx, supabase: scoped });
    const res = await createTaskRoute(
      req('POST', { title: 'Call back', contact_id: 'c1' })
    );
    expect(res.status).toBe(201);
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Call back', accountId: 'acct-1' })
    );
  });

  it('rejects blank title', async () => {
    const res = await createTaskRoute(req('POST', { title: '  ' }));
    expect(res.status).toBe(400);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('rejects invalid due_at', async () => {
    const res = await createTaskRoute(req('POST', { title: 'x', due_at: 'not-a-date' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/tasks/[id]', () => {
  it('completes via the domain writer (fires task_completed)', async () => {
    mocks.completeTask.mockResolvedValue({ completed: true, task: { id: 'task-1' } });
    const res = await patchTask(req('PATCH', { action: 'complete' }), params);
    expect(res.status).toBe(200);
    expect(mocks.completeTask).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1', taskId: 'task-1' }
    );
  });

  it('is idempotent when already completed', async () => {
    mocks.completeTask.mockResolvedValue({ completed: false, task: { id: 'task-1' } });
    const res = await patchTask(req('PATCH', { action: 'complete' }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ completed: false });
  });

  it('rejects empty patches', async () => {
    const res = await patchTask(req('PATCH', {}), params);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tasks', () => {
  it('lists with status filter', async () => {
    const scoped = mockSupabase();
    mocks.requireRole.mockResolvedValueOnce({ ...ctx, supabase: scoped });
    const res = await listTasks(new Request('http://localhost/api/tasks?status=open'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/tasks/[id]', () => {
  it('returns 404 for foreign tasks', async () => {
    const res = await getTask(new Request('http://localhost/api/tasks/task-1'), params);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/[id]', () => {
  it('returns 404 for foreign tasks', async () => {
    const res = await deleteTask(new Request('http://localhost/api/tasks/task-1', { method: 'DELETE' }), params);
    expect(res.status).toBe(404);
  });
});
