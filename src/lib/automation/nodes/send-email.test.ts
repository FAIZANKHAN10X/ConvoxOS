import { describe, expect, it, vi } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, ExecutionContext } from '../types';
import { sendEmailAction } from './send-email';
import './index';

const sent: Array<{ channel: string; subject: string; text: string }> = [];
vi.mock('@/lib/channels/socket', () => ({
  dispatchText: vi.fn(async (args: {
    channel: string;
    subject?: string | null;
    text: string;
  }) => {
    sent.push({ channel: args.channel, subject: args.subject ?? '', text: args.text });
    return { providerMessageId: 'resend_x', messageId: 'msg-1' };
  }),
  ChannelSocketError: class ChannelSocketError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

function event(): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.TAG_ADDED,
    contactId: 'contact-1',
    payload: {},
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

// conversations + contacts + email_templates + messages(idempotency).
function mockDb(seed: {
  templates?: Array<Record<string, unknown>>;
  contact?: Record<string, unknown> | null;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    conversations: [{ id: 'conv-1', account_id: 'acct-1', contact_id: 'contact-1' }],
    contacts: seed.contact === null ? [] : [
      {
        id: 'contact-1',
        account_id: 'acct-1',
        name: 'Ann',
        email: 'ann@example.com',
        phone: '+14155550100',
        company: 'Acme',
        ...(seed.contact ?? {}),
      },
    ],
    email_templates: (seed.templates ?? []).map((r) => ({ ...r })),
    messages: [],
  };
  return {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const eqs: Array<{ col: string; val: unknown }> = [];
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
        maybeSingle: async () => ({ data: rows.find(matches) ?? null, error: null }),
      };
      return builder;
    },
  };
}

describe('action.send_email', () => {
  it('sends inline content with interpolated contact vars', async () => {
    sent.length = 0;
    const db = mockDb({});
    const result = await sendEmailAction.execute?.(ctx(db), {
      subject: 'Hi {{contact.name}}',
      text: 'You work at {{contact.company}}, {{contact.name}}.',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: 'email',
      subject: 'Hi Ann',
      text: 'You work at Acme, Ann.',
    });
  });

  it('falls back to template defaults', async () => {
    sent.length = 0;
    const db = mockDb({
      templates: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          account_id: 'acct-1',
          name: 'Welcome',
          subject: 'Welcome {{contact.name}}',
          body_text: 'Hello!',
          body_html: null,
        },
      ],
    });
    const result = await sendEmailAction.execute?.(ctx(db), {
      templateId: '11111111-1111-1111-1111-111111111111',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(sent[0]).toMatchObject({ subject: 'Welcome Ann', text: 'Hello!' });
  });

  it('fails cleanly without content or a contact conversation', async () => {
    const db = mockDb({});
    const empty = await sendEmailAction.execute?.(ctx(db), {});
    expect(empty).toMatchObject({ status: 'fail' });
    const noConv = mockDb({});
    noConv.tables.conversations.length = 0;
    const missing = await sendEmailAction.execute?.(ctx(noConv), {
      subject: 'Hi',
      text: 'Hello',
    });
    expect(missing).toMatchObject({ status: 'fail' });
  });

  it('validates empty configs at publish time', () => {
    expect(sendEmailAction.validate?.({}, {} as never)).toHaveLength(1);
    expect(
      sendEmailAction.validate?.({ subject: 'Hi', text: 'x' }, {} as never)
    ).toEqual([]);
  });
});
