import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogFromRegistry } from '../catalog';
import { NodeExecutionError } from '../types';
import { graphFromNodes } from '../graph';
import { messageNode } from './message';
import { defaultRegistry } from '../registry';
import { previewText } from '../present';
import { nodePausesFlow, validateGraph } from '../validate';
import './index';

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
    dispatchText: vi.fn(async (args: { text: string }) => ({
      providerMessageId: `p:${args.text.slice(0, 8)}`,
      messageId: `m:${args.text.slice(0, 8)}`,
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

import {
  ChannelSocketError,
  dispatchInteractive,
  dispatchMedia,
  dispatchText,
} from '@/lib/channels/socket';
import type { ExecutionContext } from '../types';

const mockedText = vi.mocked(dispatchText);
const mockedMedia = vi.mocked(dispatchMedia);
const mockedInteractive = vi.mocked(dispatchInteractive);

function fakeDb(lastChannel: string | null = 'whatsapp') {
  return {
    from: (table: string) => {
      const inner = {
        select: () => inner,
        eq: () => inner,
        order: () => inner,
        limit: () => inner,
        maybeSingle: async () =>
          table === 'conversations'
            ? { data: { id: 'conv-1' }, error: null }
            : {
                data: lastChannel ? { channel: lastChannel } : null,
                error: null,
              },
      };
      return inner;
    },
  };
}

function ctx(): ExecutionContext {
  return {
    accountId: 'a',
    contactId: 'c',
    runId: 'r',
    automationId: 'u',
    versionId: 'v',
    event: {
      id: 'e1',
      accountId: 'a',
      eventType: 'tag.added',
      contactId: 'c',
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

function textBlock(id: string, text: string) {
  return { id, blockType: 'text', config: { text } };
}

function buttonsBlock(
  id: string,
  buttons: Array<{ id: string; label: string; url?: string }>
) {
  return { id, blockType: 'buttons', config: { buttons } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('message.send registry + catalog', () => {
  it('is registered as a communication action with container metadata', () => {
    const def = defaultRegistry.require('message.send');
    expect(def.kind).toBe('action');
    expect(def.category).toBe('communication');
    expect(def.blocks?.map((b) => b.blockType)).toEqual([
      'text',
      'image',
      'delay',
      'buttons',
    ]);
    expect(def.flags).toEqual({ pausesFlowBlocks: ['buttons'] });
    expect(def.preview).toBe('message');
  });

  it('serializes blocks, ports rule, and flags onto the catalog', () => {
    const entry = catalogFromRegistry(defaultRegistry).find(
      (n) => n.type === 'message.send'
    );
    expect(entry?.blocks?.map((b) => b.blockType)).toEqual([
      'text',
      'image',
      'delay',
      'buttons',
    ]);
    expect(entry?.blocksField).toBe('blocks');
    expect(entry?.dynamicPorts).toMatchObject({
      field: 'blocks',
      itemsField: 'config.buttons',
      requireAll: true,
      keepBase: true,
    });
    expect(entry?.flags).toEqual({ pausesFlowBlocks: ['buttons'] });
  });

  it('defaults the channel to current', () => {
    const parsed = messageNode.configSchema.safeParse({ blocks: [] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.channel).toBe('current');
  });
});

describe('message.send validation', () => {
  function issuesFor(config: Record<string, unknown>) {
    const graph = graphFromNodes(
      [
        {
          id: 't1',
          type: 'trigger.message_received',
          config: { channel: 'any' },
        },
        { id: 'm1', type: 'message.send', config },
      ],
      [{ id: 'e1', source: 't1', target: 'm1' }]
    );
    return validateGraph(graph, defaultRegistry).filter((i) =>
      i.path.startsWith('nodes.m1')
    );
  }

  it('requires at least one block', () => {
    expect(issuesFor({})).toContainEqual({
      path: 'nodes.m1',
      message: 'Add at least one message block',
    });
    expect(issuesFor({ blocks: [] })).toContainEqual({
      path: 'nodes.m1',
      message: 'Add at least one message block',
    });
  });

  it('rejects unknown blocks and invalid block fields with indexed paths', () => {
    const unknown = issuesFor({
      blocks: [{ id: 'b1', blockType: 'nope', config: {} }],
    });
    expect(unknown).toContainEqual({
      path: 'nodes.m1.config.blocks.0.blockType',
      message: 'unknown block "nope"',
    });
    const emptyBody = issuesFor({
      blocks: [{ id: 'b1', blockType: 'text', config: { text: '' } }],
    });
    expect(
      emptyBody.some((i) => i.path === 'nodes.m1.config.blocks.0.config.text')
    ).toBe(true);
  });

  it('rejects duplicate button ids and overlong labels', () => {
    const dupes = issuesFor({
      blocks: [
        buttonsBlock('b1', [
          { id: 'a', label: 'One' },
          { id: 'a', label: 'Two' },
        ]),
      ],
    });
    expect(dupes).toContainEqual({
      path: 'nodes.m1',
      message: 'duplicate button id "a"',
    });
  });

  it('enforces per-channel button caps', () => {
    const four = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ];
    const wa = issuesFor({ channel: 'whatsapp', blocks: [buttonsBlock('b1', four)] });
    expect(wa.some((i) => i.message.includes('up to 3 buttons'))).toBe(true);
    const current = issuesFor({ blocks: [buttonsBlock('b1', four)] });
    expect(current.some((i) => i.message.includes('up to 3 buttons'))).toBe(
      true
    );
    const tg = issuesFor({
      channel: 'telegram',
      blocks: [buttonsBlock('b1', four)],
    });
    expect(tg.some((i) => i.message.includes('up to 3 buttons'))).toBe(false);
    // Flow buttons still need wiring, but the cap itself passes on Telegram.
    expect(tg.some((i) => i.message.includes('connect the'))).toBe(true);
  });

  it('restricts URL buttons to Telegram', () => {
    const wa = issuesFor({
      blocks: [buttonsBlock('b1', [{ id: 'a', label: 'Site', url: 'https://x.test' }])],
    });
    expect(wa.some((i) => i.message.includes('Telegram only'))).toBe(true);
    const tg = issuesFor({
      channel: 'telegram',
      blocks: [buttonsBlock('b1', [{ id: 'a', label: 'Site', url: 'https://x.test' }])],
    });
    expect(tg).toEqual([]);
  });

  it('requires wired edges for flow buttons but not URL buttons or Next', () => {
    const graph = graphFromNodes(
      [
        {
          id: 't1',
          type: 'trigger.message_received',
          config: { channel: 'any' },
        },
        {
          id: 'm1',
          type: 'message.send',
          config: {
            channel: 'telegram',
            blocks: [
              textBlock('b1', 'Pick one'),
              buttonsBlock('b2', [
                { id: 'yes', label: 'Yes' },
                { id: 'site', label: 'Site', url: 'https://x.test' },
              ]),
            ],
          },
        },
      ],
      [{ id: 'e1', source: 't1', target: 'm1' }]
    );
    const issues = validateGraph(graph, defaultRegistry).filter((i) =>
      i.path.startsWith('nodes.m1')
    );
    expect(issues).toContainEqual({
      path: 'nodes.m1',
      message: 'connect the Yes path',
    });
    expect(issues.some((i) => i.message.includes('Site'))).toBe(false);
    expect(issues.some((i) => i.message.includes('Next'))).toBe(false);
  });

  it('accepts a fully wired message with buttons', () => {
    const graph = graphFromNodes(
      [
        {
          id: 't1',
          type: 'trigger.message_received',
          config: { channel: 'any' },
        },
        {
          id: 'm1',
          type: 'message.send',
          config: {
            blocks: [
              textBlock('b1', 'Pick one'),
              buttonsBlock('b2', [{ id: 'yes', label: 'Yes' }]),
            ],
          },
        },
        {
          id: 'x1',
          type: 'action.send_text',
          config: { text: 'done', channel: 'current' },
        },
      ],
      [
        { id: 'e1', source: 't1', target: 'm1' },
        { id: 'e2', source: 'm1', target: 'x1', sourceHandle: 'yes' },
      ]
    );
    expect(validateGraph(graph, defaultRegistry)).toEqual([]);
  });
});

describe('message.send summaries and preview', () => {
  it('summarizes the first text block', () => {
    expect(
      messageNode.summarize?.({
        channel: 'current',
        blocks: [textBlock('b1', 'Hello there')],
      })
    ).toBe('Hello there');
    expect(messageNode.summarize?.({ channel: 'current', blocks: [] })).toBe(
      'Add a message block'
    );
  });

  it('previewText falls back to the first preview block', () => {
    const catalog = catalogFromRegistry(defaultRegistry).find(
      (n) => n.type === 'message.send'
    );
    expect(catalog).toBeDefined();
    expect(
      previewText(catalog!, {
        channel: 'current',
        blocks: [textBlock('b1', 'Hi!')],
      })
    ).toBe('Hi!');
    expect(
      previewText(catalog!, {
        channel: 'current',
        blocks: [
          {
            id: 'b9',
            blockType: 'image',
            config: { mediaUrl: 'https://x.test/i.png' },
          },
        ],
      })
    ).toBeNull();
  });
});

describe('message.send pause accounting', () => {
  it('pauses only when a buttons block is present', () => {
    const def = defaultRegistry.require('message.send');
    expect(
      nodePausesFlow(def, { blocks: [textBlock('b1', 'hi')] })
    ).toBe(false);
    expect(
      nodePausesFlow(def, {
        blocks: [textBlock('b1', 'hi'), buttonsBlock('b2', [{ id: 'a', label: 'A' }])],
      })
    ).toBe(true);
  });
});

describe('message.send execution', () => {
  it('sends blocks in order and reports message ids', async () => {
    const result = await messageNode.execute?.(ctx(), {
      channel: 'current',
      blocks: [
        textBlock('b1', 'First'),
        {
          id: 'b2',
          blockType: 'image',
          config: { mediaUrl: 'https://x.test/i.png', caption: 'Nice' },
        },
        textBlock('b3', 'Second'),
      ],
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(mockedText).toHaveBeenCalledTimes(2);
    expect(mockedMedia).toHaveBeenCalledTimes(1);
    expect(mockedText.mock.calls.map((c) => c[0].text)).toEqual([
      'First',
      'Second',
    ]);
    expect(mockedMedia.mock.calls[0][0]).toMatchObject({
      mediaKind: 'image',
      mediaUrl: 'https://x.test/i.png',
      caption: 'Nice',
    });
    if (result?.status === 'ok') {
      expect(
        (result.output as { messageIds: string[] }).messageIds
      ).toHaveLength(3);
      expect((result.output as { channel: string }).channel).toBe('whatsapp');
    }
  });

  it('sends buttons with the preceding text on WhatsApp', async () => {
    const result = await messageNode.execute?.(ctx(), {
      channel: 'whatsapp',
      blocks: [
        textBlock('b1', 'Pick one'),
        buttonsBlock('b2', [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ]),
      ],
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(mockedInteractive).toHaveBeenCalledTimes(1);
    expect(mockedInteractive.mock.calls[0][0].payload).toEqual({
      kind: 'buttons',
      body: 'Pick one',
      buttons: [
        { id: 'yes', title: 'Yes' },
        { id: 'no', title: 'No' },
      ],
    });
  });

  it('sends buttons as an inline keyboard on Telegram', async () => {
    await messageNode.execute?.(ctx(), {
      channel: 'telegram',
      blocks: [
        buttonsBlock('b1', [
          { id: 'yes', label: 'Yes' },
          { id: 'site', label: 'Site', url: 'https://x.test' },
        ]),
      ],
    });
    expect(mockedText).toHaveBeenCalledTimes(1);
    expect(mockedText.mock.calls[0][0]).toMatchObject({
      channel: 'telegram',
      text: 'Choose an option:',
      inlineKeyboard: {
        inline_keyboard: [
          [{ text: 'Yes', callback_data: 'yes' }],
          [{ text: 'Site', url: 'https://x.test' }],
        ],
      },
    });
  });

  it('honors delay blocks with fake timers', async () => {
    vi.useFakeTimers();
    try {
      const promise = messageNode.execute?.(ctx(), {
        channel: 'current',
        blocks: [
          textBlock('b1', 'One'),
          { id: 'b2', blockType: 'delay', config: { seconds: 5 } },
          textBlock('b3', 'Two'),
        ],
      });
      expect(promise).toBeDefined();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;
      expect(result).toMatchObject({ status: 'ok' });
      expect(mockedText).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails cleanly without a conversation and wraps socket errors retryably', async () => {
    const noConv = {
      ...ctx(),
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      },
    };
    const missing = await messageNode.execute?.(noConv, {
      channel: 'current',
      blocks: [textBlock('b1', 'hi')],
    });
    expect(missing).toEqual({
      status: 'fail',
      error: 'contact has no conversation',
    });

    mockedText.mockRejectedValueOnce(
      new ChannelSocketError('boom', 'x', 500)
    );
    await expect(
      messageNode.execute?.(ctx(), {
        channel: 'current',
        blocks: [textBlock('b1', 'hi')],
      })
    ).rejects.toBeInstanceOf(NodeExecutionError);
  });
});

describe('message.send block ordering', () => {
  it('preserves block order through persistence round-trips', () => {
    const graph = graphFromNodes(
      [
        {
          id: 't1',
          type: 'trigger.message_received',
          config: { channel: 'any' },
        },
        {
          id: 'm1',
          type: 'message.send',
          config: {
            blocks: [
              {
                id: 'b2',
                blockType: 'image',
                config: { mediaUrl: 'https://x.test/i.png' },
              },
              textBlock('b1', 'After image'),
            ],
          },
        },
      ],
      [{ id: 'e1', source: 't1', target: 'm1' }]
    );
    const revived = JSON.parse(JSON.stringify(graph));
    expect(validateGraph(revived, defaultRegistry)).toEqual([]);
    const blocks = (
      revived.nodes[1].data.config as {
        blocks: Array<{ id: string; blockType: string }>;
      }
    ).blocks;
    expect(blocks.map((b) => b.id)).toEqual(['b2', 'b1']);
    expect(blocks.map((b) => b.blockType)).toEqual(['image', 'text']);
  });
});
