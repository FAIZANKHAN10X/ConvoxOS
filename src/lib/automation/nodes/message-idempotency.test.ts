import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../nodes/index';

vi.mock('@/lib/channels/socket', () => {
  class ChannelSocketError extends Error {
    code: string;
    status: number;
    constructor(message: string, code = 'x', status = 500) {
      super(message);
      this.name = 'ChannelSocketError';
      this.code = code;
      this.status = status;
    }
  }
  return {
    ChannelSocketError,
    dispatchText: vi.fn(async () => ({
      providerMessageId: 'p:1',
      messageId: 'm:1',
    })),
    dispatchMedia: vi.fn(async () => ({
      providerMessageId: 'p:media',
      messageId: 'm:media',
    })),
    dispatchInteractive: vi.fn(async () => ({
      providerMessageId: 'p:ia',
      messageId: 'm:ia',
    })),
  };
});

import { dispatchText } from '@/lib/channels/socket';
import { messageNode } from '../nodes/message';
import { sendTextAction } from '../nodes/send-text';
import type { ExecutionContext } from '../types';

const mockedText = vi.mocked(dispatchText);

function fakeDb() {
  const inner: Record<string, unknown> = {};
  inner.select = () => inner;
  inner.eq = () => inner;
  inner.order = () => inner;
  inner.limit = () => inner;
  inner.maybeSingle = async () => ({ data: { id: 'conv-1' }, error: null });
  return { from: () => inner };
}

function ctx(runId = 'run-1', nodeId = 'node-a'): ExecutionContext {
  return {
    accountId: 'acct-1',
    contactId: 'contact-1',
    runId,
    nodeId,
    automationId: 'auto-1',
    versionId: 'v-1',
    event: {
      id: 'e1',
      accountId: 'acct-1',
      eventType: 'tag_added',
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
    },
    vars: {},
    now: new Date('2026-01-01T00:00:00.000Z'),
    db: fakeDb(),
  };
}

beforeEach(() => {
  mockedText.mockClear();
});

describe('message node idempotency keys', () => {
  it('passes a stable run:node:block key on every attempt', async () => {
    const config = {
      channel: 'whatsapp' as const,
      blocks: [{ id: 'blk-1', blockType: 'text', config: { text: 'hi' } }],
    };
    await messageNode.execute!(ctx(), config);
    await messageNode.execute!(ctx(), config);
    expect(mockedText).toHaveBeenCalledTimes(2);
    const first = mockedText.mock.calls[0][0] as { idempotencyKey: string };
    const second = mockedText.mock.calls[1][0] as { idempotencyKey: string };
    expect(first.idempotencyKey).toBe('run-1:node-a:blk-1');
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('keys distinct blocks differently', async () => {
    const config = {
      channel: 'whatsapp' as const,
      blocks: [
        { id: 'blk-1', blockType: 'text', config: { text: 'one' } },
        { id: 'blk-2', blockType: 'text', config: { text: 'two' } },
      ],
    };
    await messageNode.execute!(ctx(), config);
    const keys = mockedText.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys).toEqual(['run-1:node-a:blk-1', 'run-1:node-a:blk-2']);
  });

  it('send_text uses a stable key', async () => {
    await sendTextAction.execute!(ctx(), {
      text: 'hello',
      channel: 'whatsapp',
    });
    await sendTextAction.execute!(ctx(), {
      text: 'hello',
      channel: 'whatsapp',
    });
    const keys = mockedText.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys[0]).toBe('run-1:node-a:text');
    expect(keys[1]).toBe(keys[0]);
  });
});
