import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MAX_EVENT_CHAIN_DEPTH,
  MAX_NODE_EXECUTIONS_PER_INVOCATION,
} from './constants';
import { cancelRun, createRunFromMatch, executeRun } from './engine';
import { graphFromNodes } from './graph';
import { matchTriggers } from './match';
import { createMemoryStore } from './memory-store';
import { builtinNodes } from './nodes';
import { disableAutomation, publishAutomation, saveDraft } from './publish';
import { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { DomainEvent, NodeDefinition } from './types';
import { NodeExecutionError } from './types';
import { processDomainEvent, runAutomationWorker } from './worker';

const TAG = '11111111-1111-1111-1111-111111111111';
const TAG_B = '22222222-2222-2222-2222-222222222222';

function clock(start: Date) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function makeRegistry(
  extra: NodeDefinition[] = [],
  record?: string[]
): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of builtinNodes) registry.register(node);
  for (const node of extra) registry.register(node);
  if (record) {
    registry.register({
      type: 'action.record',
      kind: 'action',
      label: 'Record',
      description: 'Test spy',
      category: 'crm',
      configSchema: z.object({ label: z.string() }),
      execute(_ctx, config: { label: string }) {
        record.push(config.label);
        return { status: 'ok', output: { label: config.label } };
      },
    });
  }
  return registry;
}

async function seedPublished(
  store: AutomationStore,
  registry: NodeRegistry,
  graph: ReturnType<typeof graphFromNodes>,
  name = 'Test'
) {
  const auto = await store.insertAutomation({
    accountId: 'acct-1',
    createdBy: 'user-1',
    name,
  });
  await saveDraft(store, auto.id, graph);
  return publishAutomation(store, registry, auto.id, 'user-1');
}

function enqueueTag(
  store: AutomationStore,
  tagId: string,
  extras: {
    idempotencyKey?: string;
    chainDepth?: number;
    source?: 'crm' | 'automation';
  } = {}
): Promise<DomainEvent> {
  return store.insertEvent({
    accountId: 'acct-1',
    eventType: 'tag_added',
    contactId: 'contact-1',
    payload: { tag_id: tagId },
    idempotencyKey: extras.idempotencyKey ?? crypto.randomUUID(),
    chainDepth: extras.chainDepth ?? 0,
    source: extras.source ?? 'crm',
  });
}

describe('trigger matching', () => {
  it('matches only the configured tag and skips deep chains', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'w',
            type: 'timing.wait',
            config: { amount: 1, unit: 'hours' },
          },
        ],
        [{ source: 't', target: 'w' }]
      )
    );

    const hit = await enqueueTag(store, TAG);
    const miss = await enqueueTag(store, TAG_B, { idempotencyKey: 'miss' });
    const deep = await enqueueTag(store, TAG, {
      idempotencyKey: 'deep',
      chainDepth: MAX_EVENT_CHAIN_DEPTH,
    });

    expect((await matchTriggers(store, registry, hit)).length).toBe(1);
    expect((await matchTriggers(store, registry, miss)).length).toBe(0);
    expect((await matchTriggers(store, registry, deep)).length).toBe(0);
  });
});

describe('inbound webhook → native automation', () => {
  const HOOK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function enqueueHook(
    store: AutomationStore,
    extras: {
      hookId?: string;
      contactId?: string | null;
      idempotencyKey?: string;
    } = {}
  ) {
    return store.insertEvent({
      accountId: 'acct-1',
      eventType: 'external.received',
      contactId: extras.contactId === undefined ? 'contact-1' : extras.contactId,
      payload: { hook_id: extras.hookId ?? HOOK, automation_id: 'auto-1' },
      source: 'external',
      idempotencyKey: extras.idempotencyKey ?? crypto.randomUUID(),
    });
  }

  it('matches only its own hook and starts a run that executes native nodes', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.inbound_webhook', config: { hookId: HOOK } },
          { id: 'a', type: 'action.record', config: { label: 'from-hook' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );

    const hit = await enqueueHook(store);
    const miss = await enqueueHook(store, {
      hookId: OTHER,
      idempotencyKey: 'other-hook',
    });
    expect((await matchTriggers(store, registry, hit)).length).toBe(1);
    expect((await matchTriggers(store, registry, miss)).length).toBe(0);

    const deps = { store, registry, db: {} };
    const result = await processDomainEvent(deps, hit.id);
    expect(result.runsCreated).toBe(1);
    expect(record).toEqual(['from-hook']);
    const processed = await store.getEvent(hit.id);
    expect(processed?.status).toBe('processed');
  });

  it('records contactless deliveries without starting a run', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.inbound_webhook', config: { hookId: HOOK } },
          { id: 'a', type: 'action.record', config: { label: 'nope' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );

    const event = await enqueueHook(store, { contactId: null });
    const deps = { store, registry, db: {} };
    const result = await processDomainEvent(deps, event.id);
    expect(result.runsCreated).toBe(0);
    expect(record).toEqual([]);
    expect((await store.getEvent(event.id))?.status).toBe('processed');
  });
});

describe('execution', () => {
  it('runs tag_added → action and completes', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'a', type: 'action.record', config: { label: 'hello' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );

    const deps = { store, registry, db: {} };
    const event = await enqueueTag(store, TAG);
    const run = await createRunFromMatch(deps, event, {
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
    });
    expect(run).toBeTruthy();
    await executeRun(deps, run!.id);
    expect(record).toEqual(['hello']);
    const finished = await store.getRun(run!.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.context).toMatchObject({
      lastOutput: { label: 'hello' },
      outputs: { a: { label: 'hello' } },
    });
  });

  it('waits without sleeping and resumes on the pinned version', async () => {
    const time = clock(new Date('2026-01-01T00:00:00.000Z'));
    const store = createMemoryStore(time.now);
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'w',
            type: 'timing.wait',
            config: { amount: 1, unit: 'hours' },
          },
          { id: 'a', type: 'action.record', config: { label: 'v1' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );

    const deps = { store, registry, db: {}, now: time.now };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    expect(record).toEqual([]);
    const waiting = await store.findActiveRun(auto.id, 'contact-1');
    expect(waiting?.status).toBe('waiting');
    const pinned = waiting!.versionId;

    await saveDraft(
      store,
      auto.id,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'a', type: 'action.record', config: { label: 'v2' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );
    await publishAutomation(store, registry, auto.id, 'user-1');

    time.advance(3_600_001);
    await runAutomationWorker(deps);
    expect(record).toEqual(['v1']);
    const finished = await store.getRun(waiting!.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.versionId).toBe(pinned);
  });

  it('keeps one active run per contact + automation', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'w',
            type: 'timing.wait',
            config: { amount: 1, unit: 'days' },
          },
        ],
        [{ source: 't', target: 'w' }]
      )
    );

    const deps = { store, registry, db: {} };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    const first = await store.findActiveRun(auto.id, 'contact-1');
    const second = await createRunFromMatch(
      deps,
      await enqueueTag(store, TAG, { idempotencyKey: 'e2' }),
      { automationId: auto.id, versionId: auto.publishedVersionId! }
    );
    expect(second?.id).toBe(first?.id);
  });

  it('does not start new runs when the automation is disabled', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'a', type: 'action.record', config: { label: 'go' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );
    await disableAutomation(store, auto.id);

    const deps = { store, registry, db: {} };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    expect(record).toEqual([]);
    expect(await store.findActiveRun(auto.id, 'contact-1')).toBeNull();
  });

  it('lets an in-flight run finish after disable', async () => {
    const time = clock(new Date('2026-01-01T00:00:00.000Z'));
    const store = createMemoryStore(time.now);
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'w',
            type: 'timing.wait',
            config: { amount: 1, unit: 'hours' },
          },
          { id: 'a', type: 'action.record', config: { label: 'late' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );

    const deps = { store, registry, db: {}, now: time.now };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    await disableAutomation(store, auto.id);
    time.advance(3_600_001);
    await runAutomationWorker(deps);
    expect(record).toEqual(['late']);
  });

  it('skips side effects when a succeeded step already exists', async () => {
    const store = createMemoryStore();
    let sends = 0;
    const registry = makeRegistry([
      {
        type: 'action.spy_send',
        kind: 'action',
        label: 'Spy',
        description: 'count',
        category: 'communication',
        configSchema: z.object({}),
        execute() {
          sends += 1;
          return { status: 'ok', output: { sends } };
        },
      },
    ]);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 's', type: 'action.spy_send', config: {} },
        ],
        [{ source: 't', target: 's' }]
      )
    );

    const event = await enqueueTag(store, TAG);
    const deps = { store, registry, db: {} };
    const run = await createRunFromMatch(deps, event, {
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
    });
    await executeRun(deps, run!.id);
    expect(sends).toBe(1);

    await store.updateRun(run!.id, {
      status: 'queued',
      currentNodeId: 's',
      completedAt: null,
    });
    await executeRun(deps, run!.id);
    expect(sends).toBe(1);
  });

  it('retries a retryable failure then succeeds', async () => {
    const time = clock(new Date('2026-01-01T00:00:00.000Z'));
    const store = createMemoryStore(time.now);
    let attempts = 0;
    const registry = makeRegistry([
      {
        type: 'action.flaky',
        kind: 'action',
        label: 'Flaky',
        description: 'fails once',
        category: 'crm',
        configSchema: z.object({}),
        execute() {
          attempts += 1;
          if (attempts < 2) {
            throw new NodeExecutionError('temporary', true);
          }
          return { status: 'ok' };
        },
      },
    ]);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'f', type: 'action.flaky', config: {} },
        ],
        [{ source: 't', target: 'f' }]
      )
    );

    const deps = { store, registry, db: {}, now: time.now };
    const run = await createRunFromMatch(deps, await enqueueTag(store, TAG), {
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
    });
    const paused = await executeRun(deps, run!.id);
    expect(paused?.status).toBe('queued');
    expect(attempts).toBe(1);

    time.advance(2000);
    await runAutomationWorker(deps);
    expect(attempts).toBe(2);
    const finished = await store.getRun(run!.id);
    expect(finished?.status).toBe('completed');
  });

  it('branches on a condition node', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'c',
            type: 'logic.condition',
            config: { subject: 'event.tag_id', op: 'eq', value: TAG },
          },
          { id: 'yes', type: 'action.record', config: { label: 'yes' } },
          { id: 'no', type: 'action.record', config: { label: 'no' } },
        ],
        [
          { source: 't', target: 'c' },
          { source: 'c', target: 'yes', sourceHandle: 'true' },
          { source: 'c', target: 'no', sourceHandle: 'false' },
        ]
      )
    );

    await processDomainEvent(
      { store, registry, db: {} },
      (await enqueueTag(store, TAG)).id
    );
    expect(record).toEqual(['yes']);
  });

  it('stops an invocation at the 25-node budget and continues later', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const nodes: Array<{
      id: string;
      type: string;
      config?: Record<string, unknown>;
    }> = [{ id: 't', type: 'trigger.tag_added', config: { tagId: TAG } }];
    const edges: Array<{ source: string; target: string }> = [];
    for (let i = 0; i < MAX_NODE_EXECUTIONS_PER_INVOCATION + 2; i += 1) {
      const id = `n${i}`;
      nodes.push({
        id,
        type: 'action.record',
        config: { label: String(i) },
      });
      edges.push({
        source: i === 0 ? 't' : `n${i - 1}`,
        target: id,
      });
    }
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(nodes, edges)
    );

    const deps = { store, registry, db: {} };
    const run = await createRunFromMatch(deps, await enqueueTag(store, TAG), {
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
    });
    const paused = await executeRun(deps, run!.id);
    expect(paused?.status).toBe('queued');
    expect(record).toHaveLength(MAX_NODE_EXECUTIONS_PER_INVOCATION);

    await runAutomationWorker(deps);
    expect(record.length).toBe(MAX_NODE_EXECUTIONS_PER_INVOCATION + 2);
    expect((await store.getRun(run!.id))?.status).toBe('completed');
  });

  it('cancel stops future work without deleting history', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'w',
            type: 'timing.wait',
            config: { amount: 1, unit: 'days' },
          },
        ],
        [{ source: 't', target: 'w' }]
      )
    );
    const deps = { store, registry, db: {} };
    const run = await createRunFromMatch(deps, await enqueueTag(store, TAG), {
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
    });
    await executeRun(deps, run!.id);
    await cancelRun(store, run!.id);
    const cancelled = await store.getRun(run!.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(await store.findActiveRun(auto.id, 'contact-1')).toBeNull();
  });
});

describe('node registry extension', () => {
  it('executes a newly registered node without engine changes', async () => {
    const store = createMemoryStore();
    const created: string[] = [];
    const registry = makeRegistry([
      {
        type: 'action.create_deal',
        kind: 'action',
        label: 'Create deal',
        description: 'Node #50 proof',
        category: 'crm',
        configSchema: z.object({ title: z.string() }),
        execute(_ctx, config: { title: string }) {
          created.push(config.title);
          return { status: 'ok', output: { title: config.title } };
        },
      },
    ]);
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          {
            id: 'd',
            type: 'action.create_deal',
            config: { title: 'New deal' },
          },
        ],
        [{ source: 't', target: 'd' }]
      )
    );

    await processDomainEvent(
      { store, registry, db: {} },
      (await enqueueTag(store, TAG)).id
    );
    expect(created).toEqual(['New deal']);
  });
});
