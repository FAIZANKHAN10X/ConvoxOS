import { describe, expect, it } from 'vitest';

import {
  AppointmentWriteError,
  createAppointment,
  setAppointmentStatus,
  updateAppointment,
} from './write';

function mockDb(seed: {
  contacts?: Array<Record<string, unknown>>;
  appointments?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    contacts: (seed.contacts ?? []).map((r) => ({ ...r })),
    appointments: (seed.appointments ?? []).map((r) => ({ ...r })),
  };
  return {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const eqs: Array<{ col: string; val: unknown }> = [];
      let update: Record<string, unknown> | null = null;
      let inserted: Record<string, unknown> | null = null;
      const matches = (r: Record<string, unknown>) =>
        eqs.every(({ col, val }) => r[col] === val);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: 'appt-new', ...payload };
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        maybeSingle: async () => ({ data: rows.find(matches) ?? null, error: null }),
        single: async () => {
          if (inserted) {
            rows.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          if (!update) return { data: null, error: { message: 'no row' } };
          const row = rows.find(matches);
          if (!row) return { data: null, error: { message: 'no row' } };
          Object.assign(row, update);
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

const CONTACT = { id: 'contact-1', account_id: 'acct-1' };
const APPT = {
  id: 'appt-1',
  account_id: 'acct-1',
  contact_id: 'contact-1',
  title: 'Intro call',
  starts_at: '2026-10-01T10:00:00.000Z',
  ends_at: null,
  status: 'booked',
  notes: null,
};

describe('createAppointment writer', () => {
  it('books with validated times', async () => {
    const db = mockDb({ contacts: [{ ...CONTACT }] });
    const appt = await createAppointment(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      title: '  Intro call  ',
      startsAt: '2026-10-01T10:00:00Z',
    });
    expect(appt.title).toBe('Intro call');
    expect(appt.status).toBe('booked');
    expect(db.tables.appointments).toHaveLength(1);
  });

  it('404s on foreign contacts and 400s on bad times', async () => {
    const db = mockDb({ contacts: [{ ...CONTACT }] });
    await expect(
      createAppointment(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'missing',
        title: 'X',
        startsAt: '2026-10-01T10:00:00Z',
      })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createAppointment(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
        title: 'X',
        startsAt: 'not-a-date',
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createAppointment(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
        title: 'X',
        startsAt: '2026-10-01T11:00:00Z',
        endsAt: '2026-10-01T10:00:00Z',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateAppointment writer', () => {
  it('reschedules changed fields and skips no-ops', async () => {
    const db = mockDb({ contacts: [{ ...CONTACT }], appointments: [{ ...APPT }] });
    const result = await updateAppointment(db as never, {
      accountId: 'acct-1',
      appointmentId: 'appt-1',
      patch: { title: 'Intro call', notes: 'Bring deck' },
    });
    expect(result.changedFields).toEqual(['notes']);
  });

  it('404s on foreign appointments', async () => {
    const db = mockDb({ appointments: [{ ...APPT }] });
    const err = await updateAppointment(db as never, {
      accountId: 'acct-2',
      appointmentId: 'appt-1',
      patch: { title: 'X' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppointmentWriteError);
    expect((err as AppointmentWriteError).status).toBe(404);
  });
});

describe('setAppointmentStatus writer', () => {
  it('moves status and reports the transition', async () => {
    const db = mockDb({ appointments: [{ ...APPT }] });
    const result = await setAppointmentStatus(db as never, {
      accountId: 'acct-1',
      appointmentId: 'appt-1',
      status: 'confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.fromStatus).toBe('booked');
    expect(result.appointment.status).toBe('confirmed');
  });

  it('no-ops on the same status', async () => {
    const db = mockDb({ appointments: [{ ...APPT }] });
    const result = await setAppointmentStatus(db as never, {
      accountId: 'acct-1',
      appointmentId: 'appt-1',
      status: 'booked',
    });
    expect(result.changed).toBe(false);
  });
});
