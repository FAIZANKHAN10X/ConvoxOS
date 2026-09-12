import { describe, expect, it } from 'vitest';

import { createNote, NoteWriteError } from './write';

function mockDb(contacts: Array<Record<string, unknown>>) {
  const notes: Array<Record<string, unknown>> = [];
  return {
    notes,
    from(table: string) {
      if (table !== 'contacts' && table !== 'contact_notes') {
        throw new Error(`unexpected table ${table}`);
      }
      const eqs: Array<{ col: string; val: unknown }> = [];
      let inserted: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: 'note-1', ...payload };
          return builder;
        },
        maybeSingle: async () => ({
          data: contacts.find((r) => eqs.every(({ col, val }) => r[col] === val)) ?? null,
          error: null,
        }),
        single: async () => {
          if (!inserted) return { data: null, error: { message: 'no row' } };
          notes.push(inserted);
          const row = inserted;
          inserted = null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

describe('createNote writer', () => {
  it('creates a note for an owned contact', async () => {
    const db = mockDb([{ id: 'contact-1', account_id: 'acct-1' }]);
    const note = await createNote(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      text: '  Called back  ',
    });
    expect(note.note_text).toBe('Called back');
    expect(db.notes.length).toBe(1);
  });

  it('404s on foreign contacts', async () => {
    const db = mockDb([{ id: 'contact-1', account_id: 'acct-1' }]);
    const err = await createNote(db as never, {
      accountId: 'acct-2',
      userId: 'user-1',
      contactId: 'contact-1',
      text: 'x',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NoteWriteError);
    expect((err as NoteWriteError).status).toBe(404);
  });

  it('400s on blank text', async () => {
    const db = mockDb([{ id: 'contact-1', account_id: 'acct-1' }]);
    await expect(
      createNote(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
        text: '   ',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
