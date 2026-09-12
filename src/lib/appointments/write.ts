import type { SupabaseClient } from '@supabase/supabase-js';

export class AppointmentWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AppointmentWriteError';
    this.status = status;
  }
}

export type AppointmentStatus = 'booked' | 'confirmed' | 'cancelled' | 'completed';

export interface AppointmentRow {
  id: string;
  account_id: string;
  contact_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  notes: string | null;
}

const APPT_COLUMNS =
  'id, account_id, contact_id, title, starts_at, ends_at, status, notes';

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppointmentWriteError(`'${field}' is required`, 400);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new AppointmentWriteError(`'${field}' must be a valid date`, 400);
  }
  return new Date(ms).toISOString();
}

/**
 * Create an appointment after verifying the contact belongs to the
 * account. Pure DB write — the caller emits the booked event with
 * the right source.
 */
export async function createAppointment(
  db: SupabaseClient,
  input: {
    accountId: string;
    userId: string;
    contactId: string;
    title: string;
    startsAt: string;
    endsAt?: string | null;
    notes?: string | null;
    source?: string;
  }
): Promise<AppointmentRow> {
  const title = input.title.trim();
  if (!title) throw new AppointmentWriteError('Title is required', 400);
  const startsAt = parseDate(input.startsAt, 'starts_at');
  const endsAt =
    input.endsAt != null && String(input.endsAt).trim() !== ''
      ? parseDate(input.endsAt, 'ends_at')
      : null;
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AppointmentWriteError("'ends_at' must be after 'starts_at'", 400);
  }

  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (contactError || !contact) {
    throw new AppointmentWriteError('Contact not found', 404);
  }

  const { data: created, error } = await db
    .from('appointments')
    .insert({
      account_id: input.accountId,
      created_by: input.userId,
      contact_id: input.contactId,
      title,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'booked',
      notes:
        typeof input.notes === 'string' && input.notes.trim()
          ? input.notes.trim().slice(0, 2000)
          : null,
      source: input.source ?? 'manual',
    })
    .select(APPT_COLUMNS)
    .single();
  if (error || !created) {
    throw new AppointmentWriteError(
      `Failed to create appointment: ${error?.message ?? 'no row'}`
    );
  }
  return created as AppointmentRow;
}

export interface UpdateAppointmentPatch {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  notes?: string | null;
}

/**
 * Generic field update (reschedule/rename). No-op values are
 * skipped. Pure DB write — field edits emit nothing; status moves
 * go through setAppointmentStatus.
 */
export async function updateAppointment(
  db: SupabaseClient,
  input: { accountId: string; appointmentId: string; patch: UpdateAppointmentPatch }
): Promise<{ appointment: AppointmentRow; changedFields: string[] }> {
  const { data: existing, error: readError } = await db
    .from('appointments')
    .select(APPT_COLUMNS)
    .eq('id', input.appointmentId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (readError || !existing) {
    throw new AppointmentWriteError('Appointment not found', 404);
  }
  const row = existing as AppointmentRow;

  const patch: Record<string, unknown> = {};
  if (input.patch.title !== undefined) {
    const next = input.patch.title.trim();
    if (!next) throw new AppointmentWriteError('Title is required', 400);
    if (next !== row.title) patch.title = next;
  }
  const nextStarts =
    input.patch.startsAt !== undefined
      ? parseDate(input.patch.startsAt, 'starts_at')
      : row.starts_at;
  const nextEnds =
    input.patch.endsAt !== undefined
      ? input.patch.endsAt === null || String(input.patch.endsAt).trim() === ''
        ? null
        : parseDate(input.patch.endsAt, 'ends_at')
      : row.ends_at;
  if (nextEnds && Date.parse(nextEnds) <= Date.parse(nextStarts)) {
    throw new AppointmentWriteError("'ends_at' must be after 'starts_at'", 400);
  }
  if (nextStarts !== row.starts_at) patch.starts_at = nextStarts;
  if ((nextEnds ?? null) !== (row.ends_at ?? null)) patch.ends_at = nextEnds;
  if (input.patch.notes !== undefined && input.patch.notes !== null) {
    const trimmed = input.patch.notes.trim();
    const next = trimmed !== '' ? trimmed.slice(0, 2000) : null;
    if ((next ?? null) !== (row.notes ?? null)) patch.notes = next;
  } else if (input.patch.notes === null) {
    if (row.notes !== null) patch.notes = null;
  }
  if (Object.keys(patch).length === 0) {
    return { appointment: row, changedFields: [] };
  }

  const { data: updated, error } = await db
    .from('appointments')
    .update(patch)
    .eq('id', input.appointmentId)
    .eq('account_id', input.accountId)
    .select(APPT_COLUMNS)
    .single();
  if (error || !updated) {
    throw new AppointmentWriteError(
      `Failed to update appointment: ${error?.message ?? 'no row'}`
    );
  }
  return { appointment: updated as AppointmentRow, changedFields: Object.keys(patch) };
}

/**
 * Status move. Returns changed:false on no-ops (no event should
 * fire). Pure DB write — the caller emits the status event.
 */
export async function setAppointmentStatus(
  db: SupabaseClient,
  input: { accountId: string; appointmentId: string; status: AppointmentStatus }
): Promise<{ changed: boolean; appointment: AppointmentRow; fromStatus: string }> {
  const { data: existing, error: readError } = await db
    .from('appointments')
    .select(APPT_COLUMNS)
    .eq('id', input.appointmentId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (readError || !existing) {
    throw new AppointmentWriteError('Appointment not found', 404);
  }
  const row = existing as AppointmentRow;
  if (row.status === input.status) {
    return { changed: false, appointment: row, fromStatus: row.status };
  }
  // Capture before the update (the returned row carries the new state).
  const fromStatus = row.status;
  const { data: updated, error } = await db
    .from('appointments')
    .update({ status: input.status })
    .eq('id', input.appointmentId)
    .eq('account_id', input.accountId)
    .select(APPT_COLUMNS)
    .single();
  if (error || !updated) {
    throw new AppointmentWriteError(
      `Failed to update appointment status: ${error?.message ?? 'no row'}`
    );
  }
  return {
    changed: true,
    appointment: updated as AppointmentRow,
    fromStatus,
  };
}
