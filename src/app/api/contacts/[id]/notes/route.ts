import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitNoteAdded } from '@/lib/automation/crm-events';
import { createNote, NoteWriteError } from '@/lib/notes/write';

/**
 * POST /api/contacts/[id]/notes — dashboard manual note create.
 * Session-authed; writes through the shared domain writer and
 * emits `note_added(manual)` so notes participate in automation
 * like every other CRM write.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const text =
      typeof body?.note_text === 'string'
        ? body.note_text
        : typeof body?.text === 'string'
          ? body.text
          : '';
    if (!text.trim()) {
      return NextResponse.json(
        { error: 'note_text is required' },
        { status: 400 }
      );
    }

    const note = await createNote(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      text,
    });

    await emitNoteAdded({
      db: ctx.supabase,
      accountId: ctx.accountId,
      contactId: note.contact_id,
      payload: { note_id: note.id, source: 'manual' },
      idempotencyKey: `note_added:${note.id}`,
      source: 'crm',
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    if (error instanceof NoteWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
