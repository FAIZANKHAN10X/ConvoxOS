import { z } from 'zod';

import { createNote, NoteWriteError } from '@/lib/notes/write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const createNoteConfig = z.object({
  noteText: z.string().min(1).max(5000),
  contactId: z.string().uuid().optional(),
});

export const createNoteAction: NodeDefinition<z.infer<typeof createNoteConfig>> = {
  type: 'action.create_note',
  kind: 'action',
  label: 'Create note',
  description: 'Add a note to the contact timeline',
  category: 'crm',
  configSchema: createNoteConfig,
  summarize() {
    return 'Add a note';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const contactId = config.contactId ?? ctx.contactId;
    // `contact_notes.user_id` is NOT NULL (author audit). Same
    // fallback as the sibling create nodes: the account owner.
    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const authorId = (account as { owner_user_id: string } | null)?.owner_user_id ?? null;
    if (!authorId) {
      return { status: 'fail', error: 'cannot determine note author' };
    }

    let note: Awaited<ReturnType<typeof createNote>>;
    try {
      note = await createNote(db, {
        accountId: ctx.accountId,
        userId: authorId,
        contactId,
        text: config.noteText,
      });
    } catch (error) {
      if (error instanceof NoteWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    await enqueueDomainEventWithClient(db, {
      accountId: ctx.accountId,
      eventType: DOMAIN_EVENT.NOTE_ADDED,
      contactId: note.contact_id,
      payload: { note_id: note.id },
      source: 'automation',
      originRunId: ctx.runId,
      causationEventId: ctx.event.id,
      chainDepth: ctx.event.chainDepth + 1,
      idempotencyKey: `note_added:${ctx.runId}:${note.id}`,
    });

    return { status: 'ok', output: { noteId: note.id } };
  },
};
