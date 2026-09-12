import type { SupabaseClient } from '@supabase/supabase-js';

export class NoteWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'NoteWriteError';
    this.status = status;
  }
}

export interface NoteRow {
  id: string;
  account_id: string;
  contact_id: string;
  note_text: string;
}

/**
 * Create a contact note after verifying the contact belongs to
 * the account. Pure DB write — the caller emits `note_added`
 * with the right source (manual UI vs automation action).
 */
export async function createNote(
  db: SupabaseClient,
  input: { accountId: string; userId: string; contactId: string; text: string }
): Promise<NoteRow> {
  const text = input.text.trim();
  if (!text) throw new NoteWriteError('Note text is required', 400);

  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (contactError || !contact) {
    throw new NoteWriteError('Contact not found', 404);
  }

  const { data: created, error } = await db
    .from('contact_notes')
    .insert({
      contact_id: input.contactId,
      account_id: input.accountId,
      user_id: input.userId,
      note_text: text,
    })
    .select('id, account_id, contact_id, note_text')
    .single();
  if (error || !created) {
    throw new NoteWriteError(
      `Failed to create note: ${error?.message ?? 'no row'}`
    );
  }
  return created as NoteRow;
}
