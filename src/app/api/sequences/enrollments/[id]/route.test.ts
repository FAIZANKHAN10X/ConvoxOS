import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    ),
}));

vi.mock('@/lib/sequences/engine', () => ({
  pauseSequenceEnrollment: mocks.pause,
  resumeSequenceEnrollment: mocks.resume,
  cancelSequenceEnrollment: mocks.cancel,
}));

import { PATCH } from './route';

const params = { params: Promise.resolve({ id: 'enr-1' }) };

function request(action: unknown) {
  return new Request('http://localhost/api/sequences/enrollments/enr-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.pause.mockReset();
  mocks.resume.mockReset();
  mocks.cancel.mockReset();
  mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' });
  mocks.pause.mockResolvedValue(true);
  mocks.resume.mockResolvedValue(true);
  mocks.cancel.mockResolvedValue(true);
});

describe('PATCH /api/sequences/enrollments/[id]', () => {
  it('pauses via the engine with account scoping', async () => {
    const res = await PATCH(request('pause'), params);
    expect(res.status).toBe(200);
    expect(mocks.pause).toHaveBeenCalledWith('enr-1', 'acct-1');
    expect(await res.json()).toEqual({ ok: true, action: 'pause' });
  });

  it('resumes via the engine', async () => {
    const res = await PATCH(request('resume'), params);
    expect(res.status).toBe(200);
    expect(mocks.resume).toHaveBeenCalledWith('enr-1', 'acct-1');
  });

  it('cancels with manual reason', async () => {
    const res = await PATCH(request('cancel'), params);
    expect(res.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith('enr-1', 'acct-1', 'manual');
  });

  it('rejects unknown actions', async () => {
    const res = await PATCH(request('explode'), params);
    expect(res.status).toBe(400);
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  it('returns 409 when the transition is not allowed', async () => {
    mocks.pause.mockResolvedValue(false);
    const res = await PATCH(request('pause'), params);
    expect(res.status).toBe(409);
  });
});
