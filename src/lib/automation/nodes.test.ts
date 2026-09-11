import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from './event-types';
import {
  addTagAction,
  conditionNode,
  contactCreatedTrigger,
  keywordTrigger,
  messageReceivedTrigger,
  removeTagAction,
  tagAddedTrigger,
  tagRemovedTrigger,
  waitNode,
} from './nodes/index';
import { listPredicates } from './predicates';
import type { DomainEvent, ExecutionContext } from './types';

const TAG = '11111111-1111-1111-1111-111111111111';

function event(
  eventType: string,
  payload: Record<string, unknown> = {}
): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType,
    contactId: 'c1',
    payload,
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
  };
}

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    accountId: 'a',
    contactId: 'c',
    runId: 'r',
    automationId: 'u',
    versionId: 'v',
    event: event(DOMAIN_EVENT.TAG_ADDED, { tag_id: TAG }),
    vars: {},
    now: new Date('2026-01-01T00:00:00.000Z'),
    db: {},
    ...overrides,
  };
}

describe('triggers', () => {
  it('matches tag_added only for the configured tag', () => {
    expect(
      tagAddedTrigger.match?.(event(DOMAIN_EVENT.TAG_ADDED, { tag_id: TAG }), {
        tagId: TAG,
      })
    ).toBe(true);
    expect(
      tagAddedTrigger.match?.(
        event(DOMAIN_EVENT.TAG_ADDED, {
          tag_id: '33333333-3333-3333-3333-333333333333',
        }),
        { tagId: TAG }
      )
    ).toBe(false);
  });

  it('matches tag_removed only for the configured tag', () => {
    expect(
      tagRemovedTrigger.match?.(
        event(DOMAIN_EVENT.TAG_REMOVED, { tag_id: TAG }),
        { tagId: TAG }
      )
    ).toBe(true);
    expect(
      tagRemovedTrigger.match?.(
        event(DOMAIN_EVENT.TAG_ADDED, { tag_id: TAG }),
        {
          tagId: TAG,
        }
      )
    ).toBe(false);
  });

  it('matches message_received with optional channel filter', () => {
    expect(
      messageReceivedTrigger.match?.(
        event(DOMAIN_EVENT.MESSAGE_RECEIVED, {
          channel: 'telegram',
          text: 'hi',
        }),
        { channel: 'any' }
      )
    ).toBe(true);
    expect(
      messageReceivedTrigger.match?.(
        event(DOMAIN_EVENT.MESSAGE_RECEIVED, {
          channel: 'telegram',
          text: 'hi',
        }),
        { channel: 'whatsapp' }
      )
    ).toBe(false);
  });

  it('matches keyword rules against inbound text', () => {
    const inbound = event(DOMAIN_EVENT.MESSAGE_RECEIVED, {
      channel: 'whatsapp',
      text: 'Hello, please send the menu',
    });
    expect(
      keywordTrigger.match?.(inbound, {
        keywords: ['hello'],
        matchType: 'contains',
        channel: 'any',
      })
    ).toBe(true);
    expect(
      keywordTrigger.match?.(inbound, {
        keywords: ['hello'],
        matchType: 'is',
        channel: 'any',
      })
    ).toBe(false);
    expect(
      keywordTrigger.match?.(inbound, {
        keywords: ['hello'],
        matchType: 'contains',
        channel: 'telegram',
      })
    ).toBe(false);
  });

  it('matches contact_created with optional source filter', () => {
    expect(
      contactCreatedTrigger.match?.(
        event(DOMAIN_EVENT.CONTACT_CREATED, { source: 'inbound' }),
        { source: 'any' }
      )
    ).toBe(true);
    expect(
      contactCreatedTrigger.match?.(
        event(DOMAIN_EVENT.CONTACT_CREATED, { source: 'inbound' }),
        { source: 'manual' }
      )
    ).toBe(false);
  });
});

describe('timing and conditions', () => {
  it('computes wait resume times from amount and unit', () => {
    const result = waitNode.execute?.(ctx(), { amount: 24, unit: 'hours' });
    expect(result).toEqual({
      status: 'wait',
      waitUntil: '2026-01-02T00:00:00.000Z',
      output: {
        waitUntil: '2026-01-02T00:00:00.000Z',
        amount: 24,
        unit: 'hours',
      },
    });
  });

  it('registers CRM predicates without an engine switch', () => {
    const ids = listPredicates().map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(['has_tag', 'event.text', 'contact.name'])
    );
  });

  it('branches true/false on event.tag_id', async () => {
    const yes = await conditionNode.execute?.(ctx(), {
      predicate: 'event.tag_id',
      op: 'eq',
      tagId: TAG,
      mode: 'all',
    });
    expect(yes).toMatchObject({ status: 'branch', branch: 'true' });
    const no = await conditionNode.execute?.(ctx(), {
      predicate: 'event.tag_id',
      op: 'eq',
      tagId: '33333333-3333-3333-3333-333333333333',
      mode: 'all',
    });
    expect(no).toMatchObject({ status: 'branch', branch: 'false' });
  });

  it('still accepts the legacy subject field', async () => {
    const result = await conditionNode.execute?.(ctx(), {
      subject: 'event.tag_id',
      op: 'eq',
      value: TAG,
      mode: 'all',
    });
    expect(result).toMatchObject({ status: 'branch', branch: 'true' });
  });
});

function tagDb(options: {
  insertError?: { code: string; message: string };
  deleted?: unknown[];
}) {
  return {
    from(table: string) {
      const state = { op: 'select' };
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        insert() {
          state.op = 'insert';
          return builder;
        },
        delete() {
          state.op = 'delete';
          return builder;
        },
        maybeSingle() {
          if (table === 'contacts' || table === 'tags') {
            return Promise.resolve({ data: { id: 'x' }, error: null });
          }
          if (state.op === 'insert') {
            return Promise.resolve({
              data: null,
              error: options.insertError ?? null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return Object.assign(builder, {
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve(
            resolve({ data: options.deleted ?? [], error: null })
          );
        },
      });
    },
  };
}

describe('tag actions', () => {
  it('add_tag is idempotent when the join already exists', async () => {
    const result = await addTagAction.execute?.(
      ctx({
        db: tagDb({
          insertError: { code: '23505', message: 'duplicate' },
        }),
      }),
      { tagId: TAG }
    );
    expect(result).toEqual({
      status: 'ok',
      output: { added: false, tagId: TAG },
    });
  });

  it('remove_tag is a no-op when the tag is already absent', async () => {
    const result = await removeTagAction.execute?.(
      ctx({ db: tagDb({ deleted: [] }) }),
      { tagId: TAG }
    );
    expect(result).toEqual({
      status: 'ok',
      output: { removed: false, tagId: TAG },
    });
  });
});
