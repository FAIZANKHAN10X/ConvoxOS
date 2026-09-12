import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    )
  ),
}));

vi.mock('@/lib/appointments/write', () => ({
  AppointmentWriteError: class AppointmentWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  createAppointment: mocks.create,
  updateAppointment: mocks.update,
  setAppointmentStatus: mocks.setStatus,
}));

import { GET, POST } from './route';
import { PATCH } from './[id]/route';
import { AppointmentWriteError } from '@/lib/appointments/write';

const context = {
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown, url = 'http://localhost/api/appointments') {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'appt-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.setStatus.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('POST /api/appointments', () => {
  it('books an appointment (201)', async () => {
    mocks.create.mockResolvedValue({ id: 'appt-1', status: 'booked' });
    const response = await POST(
      request({
        title: 'Intro',
        contact_id: 'contact-1',
        starts_at: '2026-10-01T10:00:00Z',
      })
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        contactId: 'contact-1',
      })
    );
  });

  it('rejects missing fields before writing', async () => {
    const response = await POST(request({ title: 'No contact' }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('maps writer 404s to 404 responses', async () => {
    mocks.create.mockRejectedValue(new AppointmentWriteError('Contact not found', 404));
    const response = await POST(
      request({ title: 'X', contact_id: 'missing', starts_at: '2026-10-01T10:00:00Z' })
    );
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/appointments/[id]', () => {
  it('moves status through the writer', async () => {
    mocks.setStatus.mockResolvedValue({
      changed: true,
      appointment: { id: 'appt-1', status: 'confirmed' },
      fromStatus: 'booked',
    });
    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      params
    );
    expect(response.status).toBe(200);
    expect(mocks.setStatus).toHaveBeenCalledWith(context.supabase, {
      accountId: 'account-1',
      appointmentId: 'appt-1',
      status: 'confirmed',
    });
  });

  it('rejects bad statuses before writing', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maybe' }),
      }),
      params
    );
    expect(response.status).toBe(400);
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it('updates fields through the writer', async () => {
    mocks.update.mockResolvedValue({
      appointment: { id: 'appt-1' },
      changedFields: ['title'],
    });
    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      }),
      params
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });

  it('rejects empty patches before writing', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      params
    );
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/appointments', () => {
  it('lists with the agent role', async () => {
    const response = await GET(
      new Request('http://localhost/api/appointments')
    );
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
  });
});
