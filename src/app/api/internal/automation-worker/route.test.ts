import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  sweepOverdue: vi.fn(),
}));

vi.mock('@/lib/automation', () => ({
  createEngineDeps: () => ({ mocked: true }),
  runAutomationWorker: mocks.run,
}));

vi.mock('@/lib/tasks/overdue', () => ({
  sweepOverdueTasks: mocks.sweepOverdue,
}));

import { GET, POST } from './route';

describe('/api/internal/automation-worker', () => {
  beforeEach(() => {
    mocks.run.mockReset();
    mocks.sweepOverdue.mockReset();
    mocks.run.mockResolvedValue({
      eventsProcessed: 1,
      runsCreated: 1,
      runsExecuted: 1,
      waitsResumed: 0,
    });
    mocks.sweepOverdue.mockResolvedValue(0);
    process.env.AUTOMATION_WORKER_SECRET = 'test-secret';
  });

  it('rejects missing secrets and bad bearer tokens', async () => {
    delete process.env.AUTOMATION_WORKER_SECRET;
    delete process.env.AUTOMATION_CRON_SECRET;
    delete process.env.CRON_SECRET;
    const unconfigured = await GET(new Request('http://localhost/worker'));
    expect(unconfigured.status).toBe(503);

    process.env.AUTOMATION_WORKER_SECRET = 'test-secret';
    const denied = await GET(new Request('http://localhost/worker'));
    expect(denied.status).toBe(401);
  });

  it('drains the worker when authorized', async () => {
    const request = new Request('http://localhost/worker', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalled();
    expect(mocks.sweepOverdue).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventsProcessed: 1,
      overdueFired: 0,
    });
  });

  it('accepts the docker cron header', async () => {
    const request = new Request('http://localhost/worker', {
      headers: { 'x-cron-secret': 'test-secret' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalled();
  });
});
