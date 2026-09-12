import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  create: vi.fn(),
  emitAdded: vi.fn(),
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

vi.mock('@/lib/notes/write', () => ({
  NoteWriteError: class NoteWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  createNote: mocks.create,
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitNoteAdded: mocks.emitAdded,
}));

import { POST } from './route';
import { NoteWriteError } from '@/lib/notes/write';

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/contacts/contact-1/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'contact-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.create.mockReset();
  mocks.emitAdded.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('POST /api/contacts/[id]/notes', () => {
  it('creates a note and emits note_added', async () => {
    mocks.create.mockResolvedValue({
      id: 'note-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      note_text: 'Called back',
    });

    const response = await POST(request({ note_text: 'Called back' }), params);

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(context.supabase, {
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      text: 'Called back',
    });
    expect(mocks.emitAdded).toHaveBeenCalledTimes(1);
  });

  it('rejects blank notes before writing', async () => {
    const response = await POST(request({ note_text: '   ' }), params);
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('maps writer 404s to 404 responses', async () => {
    mocks.create.mockRejectedValue(new NoteWriteError('Contact not found', 404));

    const response = await POST(request({ note_text: 'x' }), params);

    expect(response.status).toBe(404);
    expect(mocks.emitAdded).not.toHaveBeenCalled();
  });
});
