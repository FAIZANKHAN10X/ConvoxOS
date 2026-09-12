import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation, normalizeKey } from './dedupe';

export class ContactWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export interface ContactPatch {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

export interface ContactRow {
  id: string;
  account_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
}

/**
 * Stable hash of a patch object for idempotency keys. Same patch +
 * same causation dedupes on retry; different content yields a
 * different key so sequential edits each fire. djb2 is enough —
 * this is dedup, not security.
 */
export function hashPatch(patch: Record<string, unknown>): string {
  const sorted = Object.keys(patch)
    .sort()
    .map((k) => `${k}=${JSON.stringify(patch[k])}`)
    .join(';');
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash + sorted.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function assertOwned(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactRow> {
  const { data, error } = await db
    .from('contacts')
    .select('id, account_id, name, email, phone, company')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) throw new ContactWriteError('Contact not found', 404);
  return data as ContactRow;
}

/**
 * Validated partial contact update. `undefined` leaves a field
 * untouched; `null`/string sets it (trimmed, empty → null).
 * Throws 404 for foreign contacts, 409 when a new phone belongs
 * to a different contact in the same account. Returns the fields
 * that actually changed (for event payloads) — values equal to
 * the stored row after normalization are skipped, so a no-op
 * save performs no write and emits nothing.
 */
export async function updateContact(
  db: SupabaseClient,
  input: { accountId: string; contactId: string; patch: ContactPatch }
): Promise<{ contact: ContactRow; changedFields: string[] }> {
  const existing = await assertOwned(db, input.accountId, input.contactId);

  const normalize = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  const sameValue = (field: string, next: unknown): boolean => {
    const current = normalize((existing as unknown as Record<string, unknown>)[field]);
    if (field === 'phone' && typeof next === 'string' && typeof current === 'string') {
      return normalizeKey(current) === normalizeKey(next);
    }
    return current === next;
  };

  const patch: Record<string, unknown> = {};
  for (const field of ['name', 'email', 'phone', 'company'] as const) {
    const value = input.patch[field];
    if (value === undefined) continue;
    const next = normalize(value);
    if (!sameValue(field, next)) patch[field] = next;
  }
  if (Object.keys(patch).length === 0) {
    return { contact: existing, changedFields: [] };
  }

  if (typeof patch.phone === 'string') {
    const other = await findExistingContact(
      db,
      input.accountId,
      patch.phone as string
    );
    if (other && other.id !== input.contactId) {
      throw new ContactWriteError(
        'Phone number belongs to another contact',
        409
      );
    }
  }

  const { data: updated, error } = await db
    .from('contacts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .select('id, account_id, name, email, phone, company')
    .single();
  if (error || !updated) {
    if (isUniqueViolation(error)) {
      throw new ContactWriteError(
        'Phone number belongs to another contact',
        409
      );
    }
    throw new ContactWriteError(
      `Failed to update contact: ${error?.message ?? 'no row'}`
    );
  }
  return { contact: updated as ContactRow, changedFields: Object.keys(patch) };
}
