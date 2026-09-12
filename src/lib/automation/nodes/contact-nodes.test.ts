import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent, ExecutionContext } from '../types';
import { contactUpdatedTrigger } from './contact-updated';
import { updateContactAction } from './update-contact';
import './index';

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.CONTACT_UPDATED,
    contactId: 'contact-1',
    payload: { fields: ['name'] },
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

// Minimal contacts + domain_events fake: eq-filtered maybeSingle/single,
// like-prefiltered direct await (findExistingContact), update, and
// domain_events insert for the chained enqueue.
function mockDb(seedContacts: Array<Record<string, unknown>>) {
  const contacts = seedContacts.map((r) => ({ ...r }));
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    from(table: string) {
      if (table !== 'contacts' && table !== 'domain_events') {
        throw new Error(`unexpected table ${table}`);
      }
      const rows = table === 'contacts' ? contacts : events;
      const eqs: Array<{ col: string; val: unknown }> = [];
      let like: { col: string; suffix: string } | null = null;
      let update: Record<string, unknown> | null = null;
      let inserted: Record<string, unknown> | null = null;
      const matches = (r: Record<string, unknown>) =>
        eqs.every(({ col, val }) => r[col] === val) &&
        (!like ||
          String(r[like.col] ?? '')
            .replace(/\D/g, '')
            .endsWith(like.suffix));
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        like: (col: string, pattern: string) => {
          like = { col, suffix: pattern.replace(/[%_]/g, '').replace(/\D/g, '') };
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: crypto.randomUUID(), ...payload };
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
          if (!update) return { data: null, error: { message: 'no row' } };
          const row = rows.find(matches);
          if (!row) return { data: null, error: { message: 'no row' } };
          Object.assign(row, update);
          return { data: row, error: null };
        },
        // findExistingContact awaits the builder directly.
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows.filter(matches), error: null }),
      };
      return builder;
    },
  };
}

describe('trigger.contact_updated', () => {
  it('matches contact_updated events only', () => {
    expect(contactUpdatedTrigger.match?.(event(), {})).toBe(true);
    expect(
      contactUpdatedTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.CONTACT_CREATED }),
        {}
      )
    ).toBe(false);
  });

  it('is registered in the default registry', () => {
    expect(defaultRegistry.require('trigger.contact_updated')).toBe(
      contactUpdatedTrigger
    );
    expect(defaultRegistry.require('action.update_contact')).toBe(
      updateContactAction
    );
  });
});

describe('action.update_contact', () => {
  it('updates fields and chains exactly one event', async () => {
    const db = mockDb([
      {
        id: 'contact-1',
        account_id: 'acct-1',
        name: 'Ann',
        phone: '+14155550100',
      },
    ]);
    const result = await updateContactAction.execute?.(ctx(db), {
      name: 'Ann Lee',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.events.length).toBe(1);
    expect(db.events[0]).toMatchObject({
      account_id: 'acct-1',
      event_type: DOMAIN_EVENT.CONTACT_UPDATED,
      contact_id: 'contact-1',
    });
  });

  it('emits nothing when no fields change', async () => {
    const db = mockDb([
      { id: 'contact-1', account_id: 'acct-1', name: 'Ann' },
    ]);
    const result = await updateContactAction.execute?.(ctx(db), {
      name: 'Ann',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.events.length).toBe(0);
  });

  it('fails cleanly with no fields', async () => {
    const db = mockDb([{ id: 'contact-1', account_id: 'acct-1' }]);
    const result = await updateContactAction.execute?.(ctx(db), {});
    expect(result).toMatchObject({ status: 'fail' });
  });

  it('fails cleanly on foreign contacts', async () => {
    const db = mockDb([]);
    const result = await updateContactAction.execute?.(ctx(db), {
      name: 'X',
    });
    expect(result).toMatchObject({ status: 'fail' });
  });

  it('fails cleanly on phone conflicts', async () => {
    const db = mockDb([
      { id: 'contact-1', account_id: 'acct-1', phone: '+14155550100' },
      { id: 'contact-2', account_id: 'acct-1', phone: '+14155550200' },
    ]);
    const result = await updateContactAction.execute?.(ctx(db), {
      phone: '+1 (415) 555-0200',
    });
    expect(result).toMatchObject({ status: 'fail' });
    expect(db.events.length).toBe(0);
  });
});
