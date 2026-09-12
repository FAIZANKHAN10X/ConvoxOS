import { describe, expect, it } from 'vitest';

import {
  createDeal,
  DealWriteError,
  updateDeal,
} from './write';

// Fake db for pipelines / pipeline_stages / contacts / deals.
function mockDb(seed: {
  pipelines?: Array<Record<string, unknown>>;
  stages?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    pipelines: (seed.pipelines ?? []).map((r) => ({ ...r })),
    pipeline_stages: (seed.stages ?? []).map((r) => ({ ...r })),
    contacts: (seed.contacts ?? []).map((r) => ({ ...r })),
    deals: (seed.deals ?? []).map((r) => ({ ...r })),
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
        order: () => builder,
        limit: () => builder,
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: 'deal-new', ...payload };
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

const SEED = {
  pipelines: [{ id: 'pipe-1', account_id: 'acct-1' }],
  stages: [{ id: 'stage-1', pipeline_id: 'pipe-1' }],
  contacts: [{ id: 'contact-1', account_id: 'acct-1' }],
};

const DEAL = {
  id: 'deal-1',
  account_id: 'acct-1',
  pipeline_id: 'pipe-1',
  stage_id: 'stage-1',
  contact_id: 'contact-1',
  title: 'Big deal',
  status: 'open',
  value: 1000,
};

describe('createDeal writer', () => {
  it('creates a deal after ownership checks', async () => {
    const db = mockDb(SEED);
    const deal = await createDeal(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
      contactId: 'contact-1',
      title: '  New deal  ',
      value: 500,
    });
    expect(deal.title).toBe('New deal');
    expect(deal.status).toBe('open');
    expect(db.tables.deals.length).toBe(1);
  });

  it('rejects foreign pipelines, stages, and contacts', async () => {
    const db = mockDb(SEED);
    await expect(
      createDeal(db as never, {
        accountId: 'acct-2',
        userId: 'user-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-1',
        contactId: 'contact-1',
        title: 'X',
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createDeal(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        pipelineId: 'pipe-1',
        stageId: 'missing',
        contactId: 'contact-1',
        title: 'X',
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createDeal(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-1',
        contactId: 'missing',
        title: 'X',
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects blank titles', async () => {
    const db = mockDb(SEED);
    await expect(
      createDeal(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-1',
        contactId: 'contact-1',
        title: '   ',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateDeal writer', () => {
  it('applies changed fields and skips no-ops', async () => {
    const db = mockDb({ ...SEED, deals: [{ ...DEAL }] });
    const result = await updateDeal(db as never, {
      accountId: 'acct-1',
      dealId: 'deal-1',
      patch: { title: 'Bigger deal', value: 1000 },
    });
    // value is already 1000 → only title counts.
    expect(result.changedFields).toEqual(['title']);
    expect(result.deal.title).toBe('Bigger deal');
  });

  it('returns no changes for a fully equal patch', async () => {
    const db = mockDb({ ...SEED, deals: [{ ...DEAL }] });
    const result = await updateDeal(db as never, {
      accountId: 'acct-1',
      dealId: 'deal-1',
      patch: { title: 'Big deal' },
    });
    expect(result.changedFields).toEqual([]);
  });

  it('404s on foreign deals', async () => {
    const db = mockDb({ ...SEED, deals: [{ ...DEAL }] });
    const err = await updateDeal(db as never, {
      accountId: 'acct-2',
      dealId: 'deal-1',
      patch: { title: 'X' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DealWriteError);
    expect((err as DealWriteError).status).toBe(404);
  });
});
