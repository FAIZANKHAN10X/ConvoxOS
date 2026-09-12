import { describe, expect, it, vi } from 'vitest';

const emitted: Array<{ type: string; args: unknown }> = [];
vi.mock('@/lib/automation/crm-events', () => ({
  emitContactCreated: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'contact_created', args });
  }),
  emitContactUpdated: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'contact_updated', args });
  }),
}));

import {
  FormWriteError,
  hashFormToken,
  ingestSubmission,
  normalizeFormFields,
} from './write';

const FIELDS = [
  { key: 'phone', label: 'Phone', type: 'phone', required: true },
  { key: 'name', label: 'Name', type: 'name', required: true },
  { key: 'email', label: 'Email', type: 'email', required: false },
] as const;

const FORM = {
  id: 'form-1',
  account_id: 'acct-1',
  name: 'Landing',
  fields: [...FIELDS],
  is_active: true,
};

// Fake covering contacts / form_submissions for ingest.
function mockDb(seedContacts: Array<Record<string, unknown>>) {
  const contacts = seedContacts.map((r) => ({ ...r }));
  const submissions: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  return {
    contacts,
    submissions,
    calls,
    from(table: string) {
      if (table !== 'contacts' && table !== 'form_submissions') {
        throw new Error(`unexpected table ${table}`);
      }
      const rows = table === 'contacts' ? contacts : submissions;
      const eqs: Array<{ col: string; val: unknown }> = [];
      let likeSuffix: string | null = null;
      let update: Record<string, unknown> | null = null;
      let inserted: Record<string, unknown> | null = null;
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
        insert: (payload: Record<string, unknown>) => {
          calls.push(`${table}.insert`);
          inserted = {
            id: table === 'contacts' ? 'contact-new' : 'sub-1',
            ...payload,
          };
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        maybeSingle: async () => {
          if (inserted) {
            rows.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          return { data: rows.find(matches) ?? null, error: null };
        },
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
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows.filter(matches), error: null }),
      };
      return builder;
    },
  };
}

describe('normalizeFormFields', () => {
  it('forces phone first, present, and required', () => {
    const fields = normalizeFormFields([
      { key: 'name', label: 'Name', type: 'name', required: false },
    ]);
    expect(fields[0]).toMatchObject({ key: 'phone', required: true });
    expect(fields).toHaveLength(2);
  });

  it('rejects bad schemas and duplicate keys', () => {
    expect(() => normalizeFormFields([{ key: 'x' }])).toThrow(FormWriteError);
    expect(() =>
      normalizeFormFields([
        { key: 'name', label: 'A', type: 'name', required: false },
        { key: 'name', label: 'B', type: 'name', required: false },
      ])
    ).toThrow(FormWriteError);
  });

  it('hashes tokens deterministically', () => {
    expect(hashFormToken('abc')).toBe(hashFormToken('abc'));
    expect(hashFormToken('abc')).not.toBe(hashFormToken('abd'));
  });
});

describe('ingestSubmission', () => {
  it('creates a contact and records the submission', async () => {
    emitted.length = 0;
    const db = mockDb([]);
    const result = await ingestSubmission(db as never, {
      accountId: 'acct-1',
      auditUserId: 'user-1',
      form: FORM as never,
      values: { phone: '+14155550100', name: 'Ann' },
      attribution: { utm_source: 'ads' },
      submissionKey: 'k1',
    });
    expect(result.contactCreated).toBe(true);
    expect(result.deduped).toBe(false);
    expect(result.contactId).toBe('contact-new');
    expect(db.submissions).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('contact_created');
  });

  it('updates an existing contact and emits the change', async () => {
    emitted.length = 0;
    const db = mockDb([
      {
        id: 'contact-1',
        account_id: 'acct-1',
        phone: '+14155550100',
        name: 'Ann',
      },
    ]);
    const result = await ingestSubmission(db as never, {
      accountId: 'acct-1',
      auditUserId: 'user-1',
      form: FORM as never,
      values: { phone: '+14155550100', name: 'Ann Lee' },
    });
    expect(result.contactCreated).toBe(false);
    expect(result.contactId).toBe('contact-1');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('contact_updated');
  });

  it('collapses double-submits on the submission key', async () => {
    emitted.length = 0;
    const db = mockDb([]);
    const first = await ingestSubmission(db as never, {
      accountId: 'acct-1',
      auditUserId: 'user-1',
      form: FORM as never,
      values: { phone: '+14155550100', name: 'Ann' },
      submissionKey: 'dup',
    });
    const second = await ingestSubmission(db as never, {
      accountId: 'acct-1',
      auditUserId: 'user-1',
      form: FORM as never,
      values: { phone: '+14155550100', name: 'Ann' },
      submissionKey: 'dup',
    });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(db.submissions).toHaveLength(1);
    // No second contact insert.
    expect(db.calls.filter((c) => c === 'contacts.insert')).toHaveLength(1);
  });

  it('rejects missing required fields, bad email, bad phone', async () => {
    const db = mockDb([]);
    await expect(
      ingestSubmission(db as never, {
        accountId: 'acct-1',
        auditUserId: 'user-1',
        form: FORM as never,
        values: { phone: '+14155550100' },
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestSubmission(db as never, {
        accountId: 'acct-1',
        auditUserId: 'user-1',
        form: FORM as never,
        values: { phone: '+14155550100', name: 'A', email: 'nope' },
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestSubmission(db as never, {
        accountId: 'acct-1',
        auditUserId: 'user-1',
        form: FORM as never,
        values: { phone: 'xyz', name: 'A' },
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
