import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent, ExecutionContext } from '../types';
import { createNoteAction } from './create-note';
import {
  noteAddedTrigger,
  taskCompletedTrigger,
  taskCreatedTrigger,
  taskOverdueTrigger,
} from './task-triggers';
import './index';

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.TASK_CREATED,
    contactId: 'contact-1',
    payload: { task_id: 'task-1' },
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

function mockDb() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    accounts: [{ id: 'acct-1', owner_user_id: 'user-1' }],
    contacts: [{ id: 'contact-1', account_id: 'acct-1' }],
    contact_notes: [],
    domain_events: [],
  };
  return {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const eqs: Array<{ col: string; val: unknown }> = [];
      let inserted: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: 'note-1', ...payload };
          return builder;
        },
        maybeSingle: async () => {
          if (inserted) {
            rows.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          return {
            data: rows.find((r) => eqs.every(({ col, val }) => r[col] === val)) ?? null,
            error: null,
          };
        },
        single: async () => {
          if (!inserted) return { data: null, error: { message: 'no row' } };
          rows.push(inserted);
          const row = inserted;
          inserted = null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

describe('task/note triggers', () => {
  it('matches each type only', () => {
    expect(taskCreatedTrigger.match?.(event(), {})).toBe(true);
    expect(
      taskCreatedTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.TASK_COMPLETED }),
        {}
      )
    ).toBe(false);
    expect(
      taskCompletedTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.TASK_COMPLETED }),
        {}
      )
    ).toBe(true);
    expect(
      taskOverdueTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.TASK_OVERDUE }),
        {}
      )
    ).toBe(true);
    expect(
      noteAddedTrigger.match?.(event({ eventType: DOMAIN_EVENT.NOTE_ADDED }), {})
    ).toBe(true);
  });

  it('registers all new task/note nodes', () => {
    for (const type of [
      'trigger.task_created',
      'trigger.task_completed',
      'trigger.task_overdue',
      'trigger.note_added',
      'action.create_note',
    ]) {
      expect(() => defaultRegistry.require(type)).not.toThrow();
    }
  });
});

describe('action.create_note', () => {
  it('creates a note and chains exactly one event', async () => {
    const db = mockDb();
    const result = await createNoteAction.execute?.(ctx(db), {
      noteText: 'Called back',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(db.tables.contact_notes.length).toBe(1);
    expect(db.tables.domain_events.length).toBe(1);
    expect(db.tables.domain_events[0]).toMatchObject({
      event_type: DOMAIN_EVENT.NOTE_ADDED,
      contact_id: 'contact-1',
    });
  });

  it('fails cleanly on foreign contacts', async () => {
    const db = mockDb();
    db.tables.contacts.length = 0;
    const result = await createNoteAction.execute?.(ctx(db), {
      noteText: 'x',
    });
    expect(result).toMatchObject({ status: 'fail' });
    expect(db.tables.domain_events.length).toBe(0);
  });
});
