import { describe, expect, it } from 'vitest';

import {
  createEmailTemplate,
  EmailTemplateError,
  getEmailTemplate,
  updateEmailTemplate,
} from './templates';

function mockDb(rows: Array<Record<string, unknown>> = []) {
  const tables = { email_templates: rows.map((r) => ({ ...r })) };
  return {
    tables,
    from(table: string) {
      if (table !== 'email_templates') throw new Error(`unexpected ${table}`);
      const rowsRef = tables.email_templates;
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
          if (rowsRef.some((r) => r.account_id === payload.account_id && r.name === payload.name)) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: { code: '23505' } }),
              }),
            };
          }
          inserted = { id: 'tpl-1', ...payload };
          return {
            select: () => ({
              single: async () => {
                rowsRef.push(inserted as Record<string, unknown>);
                return { data: inserted, error: null };
              },
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        maybeSingle: async () => ({ data: rowsRef.find(matches) ?? null, error: null }),
        single: async () => {
          if (inserted) {
            rowsRef.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          if (!update) return { data: null, error: { message: 'no row' } };
          const row = rowsRef.find(matches);
          if (!row) return { data: null, error: { message: 'no row' } };
          Object.assign(row, update);
          update = null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

describe('createEmailTemplate', () => {
  it('creates with trimmed fields', async () => {
    const db = mockDb();
    const tpl = await createEmailTemplate(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      name: '  Welcome  ',
      subject: 'Hi {{contact.name}}',
      bodyText: 'Hello!',
    });
    expect(tpl.name).toBe('Welcome');
    expect(db.tables.email_templates).toHaveLength(1);
  });

  it('409s on duplicate names and 400s on empty bodies', async () => {
    const db = mockDb();
    await createEmailTemplate(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      name: 'Welcome',
      subject: 'Hi',
      bodyText: 'Hello',
    });
    const err = await createEmailTemplate(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      name: 'Welcome',
      subject: 'Hi',
      bodyText: 'Hello',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailTemplateError);
    expect((err as EmailTemplateError).status).toBe(409);
    await expect(
      createEmailTemplate(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        name: 'Empty',
        subject: 'Hi',
        bodyText: '   ',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateEmailTemplate / getEmailTemplate', () => {
  it('patches and reads account-scoped rows', async () => {
    const db = mockDb([
      {
        id: 'tpl-1',
        account_id: 'acct-1',
        name: 'Welcome',
        subject: 'Hi',
        body_text: 'Hello',
        body_html: null,
      },
    ]);
    const updated = await updateEmailTemplate(db as never, {
      accountId: 'acct-1',
      templateId: 'tpl-1',
      subject: 'Hello {{contact.name}}',
    });
    expect(updated.subject).toBe('Hello {{contact.name}}');
    expect(
      await getEmailTemplate(db as never, 'acct-1', 'tpl-1')
    ).toMatchObject({ id: 'tpl-1' });
    expect(await getEmailTemplate(db as never, 'acct-2', 'tpl-1')).toBeNull();
  });

  it('404s on foreign templates', async () => {
    const db = mockDb([]);
    await expect(
      updateEmailTemplate(db as never, {
        accountId: 'acct-1',
        templateId: 'missing',
        name: 'X',
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
