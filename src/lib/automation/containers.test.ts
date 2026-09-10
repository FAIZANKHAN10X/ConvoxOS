import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { catalogFromRegistry } from './catalog';
import { conditionNode } from './nodes/condition';
import { DOMAIN_EVENT } from './event-types';
import { graphFromNodes } from './graph';
import type { DomainEvent, ExecutionContext, NodeDefinition } from './types';
import {
  longestUnpausedChain,
  nodePausesFlow,
  validateGraph,
} from './validate';
import { defaultRegistry, NodeRegistry } from './registry';
import { resolvePortsForConfig } from './ports';
import './nodes';

const textBlock = {
  blockType: 'text',
  label: 'Text',
  description: 'A text content block',
  configSchema: z.object({ body: z.string().min(1) }),
};

const buttonBlock = {
  blockType: 'button',
  label: 'Button',
  configSchema: z.object({
    label: z.string().min(1).max(20),
    url: z.string().url().optional(),
  }),
};

const tagTask = {
  taskType: 'add_tag',
  label: 'Add tag',
  configSchema: z.object({ tagId: z.string().uuid() }),
};

/**
 * Throwaway message-container shape. Proves blocks, tasks, flags, and
 * dynamic ports flow through registry → catalog → validation with
 * zero engine or UI switches. Never shipped as a real node.
 */
const fixtureMessage: NodeDefinition = {
  type: 'action.fixture_message',
  kind: 'action',
  label: 'Fixture message',
  description: 'test-only container',
  category: 'communication',
  configSchema: z.object({
    channel: z.string().optional(),
    blocks: z.array(z.unknown()).optional(),
    tasks: z.array(z.unknown()).optional(),
  }),
  blocks: [textBlock, buttonBlock],
  tasks: [tagTask],
  flags: { pausesFlow: false },
  dynamicPorts: { field: 'buttons', idField: 'id', labelField: 'label' },
  async execute() {
    return { status: 'ok', output: {} };
  },
};

/** Throwaway randomizer shape: outputsFor function override. */
const fixtureSplit: NodeDefinition = {
  type: 'logic.fixture_split',
  kind: 'action',
  label: 'Fixture split',
  description: 'test-only dynamic ports',
  category: 'logic',
  configSchema: z.object({
    variants: z.array(z.object({ id: z.string(), label: z.string() })),
  }),
  outputsFor(config: unknown) {
    const variants = (config as { variants?: Array<{ id: string; label: string }> })
      .variants;
    return {
      incoming: true,
      outgoing: (variants ?? []).map((v) => ({ id: v.id, label: v.label })),
    };
  },
  async execute() {
    return { status: 'ok', output: {} };
  },
};

function registryWithFixtures(): NodeRegistry {
  const registry = new NodeRegistry();
  for (const def of defaultRegistry.list()) registry.register(def);
  registry.register(fixtureMessage);
  registry.register(fixtureSplit);
  return registry;
}

function triggerNode(id = 't1') {
  return {
    id,
    type: 'trigger.message_received',
    config: { channel: 'any' },
    position: { x: 0, y: 0 },
  };
}

describe('P0 container contract serialization', () => {
  it('serializes blocks, tasks, flags, and dynamic rules onto the catalog', () => {
    const catalog = catalogFromRegistry(registryWithFixtures());
    const entry = catalog.find((n) => n.type === 'action.fixture_message');
    expect(entry?.blocks?.map((b) => b.blockType)).toEqual([
      'text',
      'button',
    ]);
    expect(entry?.blocks?.[0]?.jsonSchema).toMatchObject({
      type: 'object',
    });
    expect(entry?.tasks?.map((t) => t.taskType)).toEqual(['add_tag']);
    expect(entry?.flags).toEqual({ pausesFlow: false });
    expect(entry?.dynamicPorts).toEqual({
      field: 'buttons',
      idField: 'id',
      labelField: 'label',
    });
    expect(entry?.blocksField).toBe('blocks');
    expect(entry?.tasksField).toBe('tasks');
  });

  it('leaves contract fields absent on nodes that do not declare them', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const send = catalog.find((n) => n.type === 'action.send_text');
    expect(send?.blocks).toBeUndefined();
    expect(send?.tasks).toBeUndefined();
    expect(send?.flags).toBeUndefined();
    expect(send?.dynamicPorts).toBeUndefined();
  });
});

describe('P0 block validation', () => {
  it('accepts a valid block list', () => {
    const graph = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: {
            blocks: [
              { id: 'b1', blockType: 'text', config: { body: 'hi' } },
              {
                id: 'b2',
                blockType: 'button',
                config: { label: 'Buy' },
              },
            ],
          },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    expect(validateGraph(graph, registryWithFixtures())).toEqual([]);
  });

  it('rejects unknown block types with a block-indexed path', () => {
    const graph = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: { blocks: [{ id: 'b1', blockType: 'nope', config: {} }] },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    expect(validateGraph(graph, registryWithFixtures())).toContainEqual({
      path: 'nodes.m1.config.blocks.0.blockType',
      message: 'unknown block "nope"',
    });
  });

  it('rejects invalid block config with a block-indexed path', () => {
    const graph = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: { blocks: [{ id: 'b1', blockType: 'text', config: {} }] },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    const issues = validateGraph(graph, registryWithFixtures());
    expect(
      issues.some((i) => i.path === 'nodes.m1.config.blocks.0.config.body')
    ).toBe(true);
  });

  it('rejects duplicate block ids and non-list blocks', () => {
    const dupes = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: {
            blocks: [
              { id: 'b1', blockType: 'text', config: { body: 'a' } },
              { id: 'b1', blockType: 'text', config: { body: 'b' } },
            ],
          },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    expect(validateGraph(dupes, registryWithFixtures())).toContainEqual({
      path: 'nodes.m1.config.blocks.1.id',
      message: 'duplicate block id "b1"',
    });

    const notList = graphFromNodes(
      [triggerNode(), { id: 'm1', type: 'action.fixture_message', config: { blocks: 'nope' } }],
      [{ source: 't1', target: 'm1' }]
    );
    expect(
      validateGraph(notList, registryWithFixtures()).some(
        (i) => i.path === 'nodes.m1.config.blocks'
      )
    ).toBe(true);
  });

  it('round-trips blocks through persistence unchanged', () => {
    const graph = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: {
            blocks: [
              { id: 'b2', blockType: 'button', config: { label: 'B' } },
              { id: 'b1', blockType: 'text', config: { body: 'A' } },
            ],
          },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    const revived = JSON.parse(JSON.stringify(graph));
    expect(validateGraph(revived, registryWithFixtures())).toEqual([]);
    expect(
      (revived.nodes[1].data.config.blocks as Array<{ id: string }>).map(
        (b) => b.id
      )
    ).toEqual(['b2', 'b1']);
  });
});

describe('P0 task validation', () => {
  it('accepts valid tasks and rejects unknown types with indexed paths', () => {
    const tag = '11111111-1111-1111-1111-111111111111';
    const good = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: { tasks: [{ id: 'k1', taskType: 'add_tag', config: { tagId: tag } }] },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    expect(validateGraph(good, registryWithFixtures())).toEqual([]);

    const bad = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'm1',
          type: 'action.fixture_message',
          config: {
            tasks: [
              { id: 'k1', taskType: 'nope', config: {} },
              { id: 'k2', taskType: 'add_tag', config: {} },
            ],
          },
        },
      ],
      [{ source: 't1', target: 'm1' }]
    );
    const issues = validateGraph(bad, registryWithFixtures());
    expect(issues).toContainEqual({
      path: 'nodes.m1.config.tasks.0.taskType',
      message: 'unknown task "nope"',
    });
    expect(
      issues.some((i) => i.path === 'nodes.m1.config.tasks.1.config.tagId')
    ).toBe(true);
  });
});

describe('P0 dynamic ports', () => {
  it('derives one handle per config item, base ports when empty', () => {
    const base = { incoming: true, outgoing: [{ id: 'default', label: 'Next' }] };
    expect(
      resolvePortsForConfig(base, { field: 'variants' }, { variants: [] })
    ).toEqual(base);
    expect(
      resolvePortsForConfig(base, { field: 'variants' }, { nope: 1 })
    ).toEqual(base);
    expect(
      resolvePortsForConfig(
        base,
        { field: 'variants', idField: 'id', labelField: 'label' },
        { variants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
      )
    ).toEqual({
      incoming: true,
      outgoing: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
  });

  it('validates edges against outputsFor handles and rejects unknown ones', () => {
    const ok = graphFromNodes(
      [
        triggerNode(),
        {
          id: 's1',
          type: 'logic.fixture_split',
          config: {
            variants: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        },
        { id: 'x1', type: 'action.send_text', config: { text: 'x', channel: 'current' } },
        { id: 'x2', type: 'action.send_text', config: { text: 'y', channel: 'current' } },
      ],
      [
        { id: 'e0', source: 't1', target: 's1' },
        { id: 'e1', source: 's1', target: 'x1', sourceHandle: 'a' },
        { id: 'e2', source: 's1', target: 'x2', sourceHandle: 'b' },
      ]
    );
    expect(validateGraph(ok, registryWithFixtures())).toEqual([]);

    const bad = graphFromNodes(
      [
        triggerNode(),
        {
          id: 's1',
          type: 'logic.fixture_split',
          config: { variants: [{ id: 'a', label: 'A' }] },
        },
        { id: 'x1', type: 'action.send_text', config: { text: 'x', channel: 'current' } },
      ],
      [
        { id: 'e0', source: 't1', target: 's1' },
        { id: 'e1', source: 's1', target: 'x1', sourceHandle: 'zzz' },
      ]
    );
    expect(validateGraph(bad, registryWithFixtures())).toContainEqual({
      path: 'edges.e1',
      message: 'unknown output "zzz" for logic.fixture_split',
    });
  });
});

describe('P0 condition all/any truth tables', () => {
  function baseEvent(payload: Record<string, unknown>): DomainEvent {
    return {
      id: 'e1',
      accountId: 'a',
      eventType: DOMAIN_EVENT.MESSAGE_RECEIVED,
      contactId: 'c',
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

  function runCtx(payload: Record<string, unknown>): ExecutionContext {
    return {
      accountId: 'a',
      contactId: 'c',
      runId: 'r',
      automationId: 'u',
      versionId: 'v',
      event: baseEvent(payload),
      vars: {},
      now: new Date('2026-01-01T00:00:00.000Z'),
      db: {},
    };
  }

  const textIsHi = {
    predicate: 'event.text',
    op: 'eq' as const,
    value: 'hi',
  };
  const channelIsWa = {
    predicate: 'event.channel',
    op: 'eq' as const,
    value: 'whatsapp',
  };

  it('all requires every predicate to pass', async () => {
    const config = { mode: 'all' as const, predicates: [textIsHi, channelIsWa] };
    const both = await conditionNode.execute?.(
      runCtx({ text: 'hi', channel: 'whatsapp' }),
      { ...config, op: 'eq' }
    );
    expect(both).toMatchObject({ status: 'branch', branch: 'true' });
    const one = await conditionNode.execute?.(
      runCtx({ text: 'hi', channel: 'telegram' }),
      { ...config, op: 'eq' }
    );
    expect(one).toMatchObject({ status: 'branch', branch: 'false' });
  });

  it('any passes when a single predicate passes', async () => {
    const config = { mode: 'any' as const, predicates: [textIsHi, channelIsWa] };
    const one = await conditionNode.execute?.(
      runCtx({ text: 'bye', channel: 'whatsapp' }),
      { ...config, op: 'eq' }
    );
    expect(one).toMatchObject({ status: 'branch', branch: 'true' });
    const none = await conditionNode.execute?.(
      runCtx({ text: 'bye', channel: 'telegram' }),
      { ...config, op: 'eq' }
    );
    expect(none).toMatchObject({ status: 'branch', branch: 'false' });
  });

  it('legacy single-predicate configs keep working with identical output', async () => {
    const yes = await conditionNode.execute?.(
      runCtx({ text: 'hi', channel: 'whatsapp' }),
      { predicate: 'event.text', op: 'eq', value: 'hi', mode: 'all' }
    );
    expect(yes).toMatchObject({
      status: 'branch',
      branch: 'true',
      output: { predicate: 'event.text', pass: true },
    });
  });

  it('validates each predicate with an indexed message', () => {
    expect(
      conditionNode.validate?.(
        {
          mode: 'all',
          predicates: [{ predicate: 'nope', op: 'eq' }],
          op: 'eq',
        },
        graphFromNodes([], [])
      )
    ).toEqual(['condition 1: Unknown condition "nope"']);
  });
});

describe('P0 branch convergence', () => {
  it('allows two edges into the same node', () => {
    const graph = graphFromNodes(
      [
        triggerNode(),
        {
          id: 'c1',
          type: 'logic.condition',
          config: { predicate: 'event.text', op: 'contains', value: 'hi', mode: 'all' },
        },
        { id: 'x1', type: 'action.send_text', config: { text: 'x', channel: 'current' } },
      ],
      [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'x1', sourceHandle: 'true' },
        { id: 'e2', source: 'c1', target: 'x1', sourceHandle: 'false' },
      ]
    );
    expect(validateGraph(graph, defaultRegistry)).toEqual([]);
  });
});

describe('P0 pause accounting', () => {
  function chain(length: number, insertWaitAt?: number) {
    const nodes: Array<{
      id: string;
      type: string;
      config: Record<string, unknown>;
    }> = [{ id: 't1', type: 'trigger.message_received', config: { channel: 'any' } }];
    for (let i = 0; i < length; i++) {
      nodes.push(
        i === insertWaitAt
          ? { id: `n${i}`, type: 'timing.wait', config: { amount: 1, unit: 'hours' } }
          : { id: `n${i}`, type: 'action.send_text', config: { text: `m${i}`, channel: 'current' } }
      );
    }
    const edges = nodes
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, source: i === 0 ? 't1' : `n${i - 1}`, target: n.id }));
    return graphFromNodes(nodes, edges);
  }

  it('flags chains longer than 30 blocks without a pause', () => {
    expect(longestUnpausedChain(chain(31), defaultRegistry)).toBe(31);
    const issues = validateGraph(chain(31), defaultRegistry);
    expect(
      issues.some((i) => i.message.includes('without a pause'))
    ).toBe(true);
  });

  it('resets the counter at waits and pausing flagged nodes', () => {
    expect(longestUnpausedChain(chain(40, 20), defaultRegistry)).toBe(20);
    expect(validateGraph(chain(40, 20), defaultRegistry)).toEqual([]);
    expect(nodePausesFlow(defaultRegistry.require('timing.wait'))).toBe(true);
    expect(nodePausesFlow(defaultRegistry.require('action.send_text'))).toBe(
      false
    );
    expect(nodePausesFlow(fixtureMessage)).toBe(false);
  });
});
