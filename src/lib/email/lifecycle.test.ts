import { describe, expect, it, vi } from 'vitest';

const emitted: Array<{ type: string; args: unknown }> = [];
vi.mock('@/lib/automation/crm-events', () => ({
  emitEmailDelivered: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'email_delivered', args });
  }),
  emitEmailBounced: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'email_bounced', args });
  }),
  emitEmailOpened: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'email_opened', args });
  }),
}));

import { handleResendLifecycleEvent } from './lifecycle';

// Fake: messages by provider id, conversations by id, status updates.
function mockDb(seed: {
  messages?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
}) {
  const messages = (seed.messages ?? []).map((r) => ({ ...r }));
  const conversations = (seed.conversations ?? []).map((r) => ({ ...r }));
  return {
    messages,
    from(table: string) {
      if (table !== 'messages' && table !== 'conversations') {
        throw new Error(`unexpected table ${table}`);
      }
      const rows = table === 'messages' ? messages : conversations;
      const eqs: Array<{ col: string; val: unknown }> = [];
      let update: Record<string, unknown> | null = null;
      const matches = (r: Record<string, unknown>) =>
        eqs.every(({ col, val }) => r[col] === val);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        limit: () => builder,
        update: (payload: Record<string, unknown>) => {
          update = payload;
          const row = rows.find(matches);
          if (row) Object.assign(row, update);
          return {
            eq: async () => ({ error: null }),
          };
        },
        maybeSingle: async () => ({ data: rows.find(matches) ?? null, error: null }),
      };
      return builder;
    },
  };
}

const MSG = {
  id: 'msg-1',
  status: 'sent',
  conversation_id: 'conv-1',
  message_id: 'resend_uuid-1',
};
const CONV = { id: 'conv-1', contact_id: 'contact-1', account_id: 'acct-1' };

function payload(type: string) {
  return { type, data: { email_id: 'uuid-1' } };
}

describe('handleResendLifecycleEvent', () => {
  it('delivers: advances status and emits', async () => {
    emitted.length = 0;
    const db = mockDb({ messages: [{ ...MSG }], conversations: [{ ...CONV }] });
    const result = await handleResendLifecycleEvent({
      db: db as never,
      accountId: 'acct-1',
      payload: payload('email.delivered'),
    });
    expect(result).toEqual({ handled: true });
    expect(db.messages[0].status).toBe('delivered');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('email_delivered');
  });

  it('bounces: fails the message and emits with reason', async () => {
    emitted.length = 0;
    const db = mockDb({ messages: [{ ...MSG }], conversations: [{ ...CONV }] });
    await handleResendLifecycleEvent({
      db: db as never,
      accountId: 'acct-1',
      payload: payload('email.bounced'),
    });
    expect(db.messages[0].status).toBe('failed');
    expect(emitted[0]).toMatchObject({
      type: 'email_bounced',
      args: expect.objectContaining({
        payload: expect.objectContaining({ reason: 'bounce' }),
      }),
    });
  });

  it('never downgrades read, and ignores unknown types', async () => {
    emitted.length = 0;
    const db = mockDb({
      messages: [{ ...MSG, status: 'read' }],
      conversations: [{ ...CONV }],
    });
    await handleResendLifecycleEvent({
      db: db as never,
      accountId: 'acct-1',
      payload: payload('email.bounced'),
    });
    expect(db.messages[0].status).toBe('read');
    expect(
      await handleResendLifecycleEvent({
        db: db as never,
        accountId: 'acct-1',
        payload: payload('email.clicked'),
      })
    ).toEqual({ handled: false });
  });

  it('ignores unknown messages and foreign conversations', async () => {
    emitted.length = 0;
    const db = mockDb({ messages: [], conversations: [{ ...CONV }] });
    expect(
      await handleResendLifecycleEvent({
        db: db as never,
        accountId: 'acct-1',
        payload: payload('email.opened'),
      })
    ).toEqual({ handled: false });
    const foreign = mockDb({
      messages: [{ ...MSG }],
      conversations: [{ ...CONV, account_id: 'acct-2' }],
    });
    expect(
      await handleResendLifecycleEvent({
        db: foreign as never,
        accountId: 'acct-1',
        payload: payload('email.opened'),
      })
    ).toEqual({ handled: false });
    expect(emitted).toHaveLength(0);
  });
});
