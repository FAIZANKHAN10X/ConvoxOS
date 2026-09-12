import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent, ExecutionContext } from '../types';
import { dealCreatedTrigger } from './deal-created';
import {
  dealLostTrigger,
  dealStatusChangedTrigger,
  dealWonTrigger,
} from './deal-status-changed';
import { createDealAction, setDealStatusAction, updateDealAction } from './deals';
import './index';

const PIPE = 'pipe-1';
const STAGE = 'stage-1';

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.DEAL_CREATED,
    contactId: 'contact-1',
    payload: { deal_id: 'deal-1', pipeline_id: PIPE, stage_id: STAGE },
    source: 'crm',
    originRunId: null,
    causationEventId: null,
    chainDepth: 0,
    idempotencyKey: 'k',
    status: 'pending',
    attempts: 0,
    availableAt: new Date().toISOString(),
    processedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function ctx(db: unknown): ExecutionContext {
  return {
    accountId: 'acct-1',
    contactId: 'contact-1',
    runId: 'run-1',
    automationId: 'auto-1',
    versionId: 'v1',
    event: event(),
    vars: {},
    now: new Date('2026-01-01T00:00:00.000Z'),
    db,
  };
}

// Fake covering accounts / pipelines / pipeline_stages / contacts /
// deals / domain_events for the deal nodes.
function mockDb(seed: {
  deals?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    accounts: [{ id: 'acct-1', owner_user_id: 'user-1' }],
    pipelines: [{ id: PIPE, account_id: 'acct-1' }],
    pipeline_stages: [{ id: STAGE, pipeline_id: PIPE }],
    contacts: [{ id: 'contact-1', account_id: 'acct-1' }],
    deals: (seed.deals ?? []).map((r) => ({ ...r })),
    domain_events: [],
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
      };
      return builder;
    },
  };
}

const DEAL = {
  id: 'deal-1',
  account_id: 'acct-1',
  pipeline_id: PIPE,
  stage_id: STAGE,
  contact_id: 'contact-1',
  title: 'Big deal',
  status: 'open',
  value: 1000,
};

describe('deal triggers', () => {
  it('deal_created matches with optional filters', () => {
    expect(dealCreatedTrigger.match?.(event(), {})).toBe(true);
    expect(
      dealCreatedTrigger.match?.(event(), { pipelineId: PIPE })
    ).toBe(true);
    expect(
      dealCreatedTrigger.match?.(event(), {
        pipelineId: '99999999-9999-9999-9999-999999999999',
      })
    ).toBe(false);
    expect(
      dealCreatedTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.DEAL_STAGE_CHANGED }),
        {}
      )
    ).toBe(false);
  });

  it('status triggers route on to_status', () => {
    const won = event({
      eventType: DOMAIN_EVENT.DEAL_STATUS_CHANGED,
      payload: { to_status: 'won' },
    });
    const lost = event({
      eventType: DOMAIN_EVENT.DEAL_STATUS_CHANGED,
      payload: { to_status: 'lost' },
    });
    expect(dealStatusChangedTrigger.match?.(won, {})).toBe(true);
    expect(
      dealStatusChangedTrigger.match?.(won, { toStatus: 'lost' })
    ).toBe(false);
    expect(dealWonTrigger.match?.(won, {})).toBe(true);
    expect(dealWonTrigger.match?.(lost, {})).toBe(false);
    expect(dealLostTrigger.match?.(lost, {})).toBe(true);
    expect(dealLostTrigger.match?.(won, {})).toBe(false);
  });

  it('registers all new deal nodes', () => {
    for (const type of [
      'trigger.deal_created',
      'trigger.deal_status_changed',
      'trigger.deal_won',
      'trigger.deal_lost',
      'action.create_deal',
      'action.update_deal',
      'action.set_deal_status',
    ]) {
      expect(() => defaultRegistry.require(type)).not.toThrow();
    }
  });
});

describe('action.create_deal', () => {
  it('creates and chains exactly one event', async () => {
    const db = mockDb({});
    const result = await createDealAction.execute?.(ctx(db), {
      title: 'New deal',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.tables.deals.length).toBe(1);
    expect(db.tables.domain_events.length).toBe(1);
    expect(db.tables.domain_events[0]).toMatchObject({
      account_id: 'acct-1',
      event_type: DOMAIN_EVENT.DEAL_CREATED,
      contact_id: 'contact-1',
    });
  });

  it('fails cleanly with no pipeline', async () => {
    const db = mockDb({});
    db.tables.pipelines.length = 0;
    const result = await createDealAction.execute?.(ctx(db), {
      title: 'X',
    });
    expect(result).toMatchObject({ status: 'fail' });
  });
});

describe('action.update_deal', () => {
  it('updates and chains on change', async () => {
    const db = mockDb({ deals: [{ ...DEAL }] });
    const result = await updateDealAction.execute?.(ctx(db), {
      title: 'Bigger deal',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.tables.domain_events.length).toBe(1);
    expect(db.tables.domain_events[0]).toMatchObject({
      event_type: DOMAIN_EVENT.DEAL_UPDATED,
    });
  });

  it('emits nothing on no-op', async () => {
    const db = mockDb({ deals: [{ ...DEAL }] });
    const result = await updateDealAction.execute?.(ctx(db), {
      title: 'Big deal',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.tables.domain_events.length).toBe(0);
  });

  it('fails cleanly with no open deal', async () => {
    const db = mockDb({});
    const result = await updateDealAction.execute?.(ctx(db), {
      title: 'X',
    });
    expect(result).toMatchObject({ status: 'fail' });
  });
});

describe('action.set_deal_status', () => {
  it('marks won and chains the status event', async () => {
    const db = mockDb({ deals: [{ ...DEAL }] });
    const result = await setDealStatusAction.execute?.(ctx(db), {
      status: 'won',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.tables.domain_events.length).toBe(1);
    expect(db.tables.domain_events[0]).toMatchObject({
      event_type: DOMAIN_EVENT.DEAL_STATUS_CHANGED,
      contact_id: 'contact-1',
    });
  });

  it('fails cleanly with no open deal', async () => {
    const db = mockDb({});
    const result = await setDealStatusAction.execute?.(ctx(db), {
      status: 'lost',
      lostReason: 'gone quiet',
    });
    expect(result).toMatchObject({ status: 'fail' });
  });
});
