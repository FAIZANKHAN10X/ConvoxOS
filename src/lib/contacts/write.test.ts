import { describe, expect, it } from 'vitest';

import { hashPatch, updateContact, ContactWriteError } from './write';

// Fake db supporting: select+eq(+like)/maybeSingle/single,
// update+eq+select+single, with an optional unique-violation trap.
function mockDb(seed: {
  contacts?: Array<Record<string, unknown>>;
  trapUnique?: boolean;
}) {
  const contacts = (seed.contacts ?? []).map((r) => ({ ...r }));
  return {
    from(table: string) {
      if (table !== 'contacts') throw new Error(`unexpected table ${table}`);
      const eqs: Array<{ col: string; val: unknown }> = [];
      let likeSuffix: string | null = null;
      let update: Record<string, unknown> | null = null;
      const matches = (r: Record<string, unknown>) =>
        eqs.every(({ col, val }) => r[col] === val) &&
        (likeSuffix === null ||
          String(r.phone ?? '')
            .replace(/\D/g, '')
            .endsWith(likeSuffix));
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        like: (_col: string, pattern: string) => {
          likeSuffix = pattern.replace(/[%_]/g, '').replace(/\D/g, '');
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        maybeSingle: async () => {
          const rows = contacts.filter(matches);
          return { data: rows[0] ?? null, error: null };
        },
        single: async () => {
          if (update) {
            if (seed.trapUnique) {
              return { data: null, error: { code: '23505', message: 'duplicate' } };
            }
            const rows = contacts.filter(matches);
            if (rows.length === 0) {
              return { data: null, error: { message: 'no row' } };
            }
            Object.assign(rows[0], update);
            return { data: rows[0], error: null };
          }
          return { data: null, error: { message: 'no row' } };
        },
        // findExistingContact awaits the builder directly.
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: contacts.filter(matches), error: null }),
      };
      return builder;
    },
  };
}

const ROW = {
  id: 'contact-1',
  account_id: 'acct-1',
  name: 'Ann',
  email: null,
  phone: '+14155550100',
  company: null,
};

describe('updateContact writer', () => {
  it('applies a partial patch and reports changed fields', async () => {
    const db = mockDb({ contacts: [{ ...ROW }] });
    const result = await updateContact(db as never, {
      accountId: 'acct-1',
      contactId: 'contact-1',
      patch: { name: 'Ann Lee', email: null },
    });
    // email is already null → no change; only name is written.
    expect(result.changedFields).toEqual(['name']);
    expect(result.contact.name).toBe('Ann Lee');
  });

  it('returns no changes for an empty patch', async () => {
    const db = mockDb({ contacts: [{ ...ROW }] });
    const result = await updateContact(db as never, {
      accountId: 'acct-1',
      contactId: 'contact-1',
      patch: {},
    });
    expect(result.changedFields).toEqual([]);
  });

  it('404s on foreign contacts', async () => {
    const db = mockDb({ contacts: [{ ...ROW }] });
    await expect(
      updateContact(db as never, {
        accountId: 'acct-2',
        contactId: 'contact-1',
        patch: { name: 'X' },
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('409s when the new phone belongs to another contact', async () => {
    const db = mockDb({
      contacts: [
        { ...ROW },
        { id: 'contact-2', account_id: 'acct-1', phone: '+14155550200' },
      ],
    });
    await expect(
      updateContact(db as never, {
        accountId: 'acct-1',
        contactId: 'contact-1',
        patch: { phone: '+1 (415) 555-0200' },
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('maps unique violations to 409 (race backstop)', async () => {
    const db = mockDb({ contacts: [{ ...ROW }], trapUnique: true });
    const err = await updateContact(db as never, {
      accountId: 'acct-1',
      contactId: 'contact-1',
      patch: { name: 'Race' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ContactWriteError);
    expect((err as ContactWriteError).status).toBe(409);
  });

  it('hashPatch is stable and content-sensitive', () => {
    expect(hashPatch({ a: '1', b: '2' })).toBe(hashPatch({ b: '2', a: '1' }));
    expect(hashPatch({ a: '1' })).not.toBe(hashPatch({ a: '2' }));
  });
});
