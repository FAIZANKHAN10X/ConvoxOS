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
import { builtinNodes } from './nodes/index';
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

  it('matches a published inbound webhook by automation id when hookId is unset', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.inbound_webhook', config: {} },
          { id: 'a', type: 'action.record', config: { label: 'wired' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );

    const rebound = await store.insertEvent({
      accountId: 'acct-1',
      eventType: 'external.received',
      contactId: 'contact-1',
      payload: { hook_id: HOOK, automation_id: auto.id },
      source: 'external',
      idempotencyKey: 'unbound-2',
    });
    const deps = { store, registry, db: {} };
    const result = await processDomainEvent(deps, rebound.id);
    expect(result.runsCreated).toBe(1);
    expect(record).toEqual(['wired']);
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
    // T5.4: conflicts no longer join the existing run — the skip is
    // recorded and the winner keeps executing (claimDueRuns owns it).
    expect(second).toBeNull();
    expect(store.skips).toHaveLength(1);
    expect(store.skips[0]).toMatchObject({
      automationId: auto.id,
      contactId: 'contact-1',
      reason: 'active_run',
      existingRunId: first?.id,
    });
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

describe('same-run external wait', () => {
  const HOOK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  async function startWaiting() {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'w', type: 'wait.external', config: { timeoutHours: 24 } },
          { id: 'a', type: 'action.record', config: { label: 'after-hook' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );
    const deps = { store, registry, db: {} };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    const waiting = await store.findActiveRun(auto.id, 'contact-1');
    return { store, registry, record, auto, deps, waiting };
  }

  function callbackEvent(
    store: AutomationStore,
    args: {
      runId: string;
      automationId: string;
      accountId?: string;
      contactId?: string | null;
      body?: Record<string, unknown>;
      idempotencyKey?: string;
    }
  ) {
    return store.insertEvent({
      accountId: args.accountId ?? 'acct-1',
      eventType: 'external.received',
      contactId:
        args.contactId === undefined ? 'contact-1' : args.contactId,
      payload: {
        hook_id: HOOK,
        automation_id: args.automationId,
        body: { run_id: args.runId, enriched: true, ...args.body },
      },
      source: 'external',
      idempotencyKey: args.idempotencyKey ?? crypto.randomUUID(),
    });
  }

  it('pauses on wait.external and exposes run_id as the correlation', async () => {
    const { waiting } = await startWaiting();
    expect(waiting?.status).toBe('waiting');
    expect(waiting?.context).toMatchObject({
      lastOutput: { runId: waiting!.id, correlation: waiting!.id },
    });
  });

  it('resumes the same run and merges the callback body', async () => {
    const { store, deps, record, auto, waiting } = await startWaiting();
    const callback = await callbackEvent(store, {
      runId: waiting!.id,
      automationId: auto.id,
    });
    const result = await processDomainEvent(deps, callback.id);
    expect(result.waitsResumed).toBe(1);
    expect(result.runsCreated).toBe(0);
    expect(record).toEqual(['after-hook']);
    expect((await store.getEvent(callback.id))?.status).toBe('processed');
    const finished = await store.getRun(waiting!.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.id).toBe(waiting!.id);
    expect(finished?.context).toMatchObject({
      callback: { run_id: waiting!.id, enriched: true },
      outputs: {
        w: {
          resumed: true,
          body: { run_id: waiting!.id, enriched: true },
        },
      },
    });
  });

  it('treats a duplicate callback as idempotent', async () => {
    const { store, deps, record, auto, waiting } = await startWaiting();
    await processDomainEvent(
      deps,
      (
        await callbackEvent(store, {
          runId: waiting!.id,
          automationId: auto.id,
          idempotencyKey: 'cb-1',
        })
      ).id
    );
    expect(record).toEqual(['after-hook']);
    await processDomainEvent(
      deps,
      (
        await callbackEvent(store, {
          runId: waiting!.id,
          automationId: auto.id,
          idempotencyKey: 'cb-2',
        })
      ).id
    );
    expect(record).toEqual(['after-hook']);
    const runs = await store.findActiveRun(auto.id, 'contact-1');
    expect(runs).toBeNull();
  });

  it('rejects a callback for the wrong contact without starting another run', async () => {
    const { store, deps, record, auto, waiting } = await startWaiting();
    const callback = await callbackEvent(store, {
      runId: waiting!.id,
      automationId: auto.id,
      contactId: 'someone-else',
    });
    const result = await processDomainEvent(deps, callback.id);
    expect(result.waitsResumed).toBe(0);
    expect(result.runsCreated).toBe(0);
    expect(record).toEqual([]);
    expect((await store.getRun(waiting!.id))?.status).toBe('waiting');
  });

  it('does not resume when the run_id does not match the waiting run', async () => {
    const { store, deps, record, auto, waiting } = await startWaiting();
    const callback = await callbackEvent(store, {
      runId: crypto.randomUUID(),
      automationId: auto.id,
    });
    const result = await processDomainEvent(deps, callback.id);
    expect(result.waitsResumed).toBe(0);
    expect(record).toEqual([]);
    expect((await store.getRun(waiting!.id))?.status).toBe('waiting');
  });

  it('does not resume a run from another account', async () => {
    const { store, deps, record, auto, waiting } = await startWaiting();
    const callback = await callbackEvent(store, {
      runId: waiting!.id,
      automationId: auto.id,
      accountId: 'acct-other',
    });
    const result = await processDomainEvent(deps, callback.id);
    expect(result.waitsResumed).toBe(0);
    expect(record).toEqual([]);
    expect((await store.getRun(waiting!.id))?.status).toBe('waiting');
  });

  it('ignores a callback with no matching wait and keeps inbound-trigger starts', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.inbound_webhook', config: { hookId: HOOK } },
          { id: 'a', type: 'action.record', config: { label: 'fresh' } },
        ],
        [{ source: 't', target: 'a' }]
      )
    );
    const deps = { store, registry, db: {} };
    const event = await callbackEvent(store, {
      runId: crypto.randomUUID(),
      automationId: auto.id,
    });
    const result = await processDomainEvent(deps, event.id);
    expect(result.waitsResumed).toBe(0);
    expect(result.runsCreated).toBe(1);
    expect(record).toEqual(['fresh']);
  });

  it('defers a callback that arrives before the wait row commits', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'w', type: 'wait.external', config: { timeoutHours: 24 } },
          { id: 'a', type: 'action.record', config: { label: 'after-hook' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );
    const deps = { store, registry, db: {} };
    // Simulate the race: run exists and is mid-execution, but its wait
    // row has not committed yet (fast n8n callback racing executeRun).
    // A real trigger event id is attached, as all genuine runs have.
    // The helper tag event itself is parked so the worker drain cannot
    // pick it up and pollute run counts.
    const trigger = await enqueueTag(store, TAG);
    await store.markEvent(trigger.id, 'processed');
    const run = await store.insertRun({
      accountId: 'acct-1',
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
      contactId: 'contact-1',
      triggerEventId: trigger.id,
      currentNodeId: 'w',
      context: {},
    });
    await store.updateRun(run.id, { status: 'running' });
    const callback = await callbackEvent(store, {
      runId: run.id,
      automationId: auto.id,
    });
    const result = await processDomainEvent(deps, callback.id);
    // No second run, no resume — the event is requeued for later.
    expect(result.runsCreated).toBe(0);
    expect(result.waitsResumed).toBe(0);
    expect(record).toEqual([]);
    expect((await store.getEvent(callback.id))?.status).toBe('pending');

    // Once the wait commits, redelivery resumes the same run.
    await store.insertWait({
      accountId: 'acct-1',
      runId: run.id,
      nodeId: 'w',
      resumeNodeId: 'a',
      resumeAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      kind: 'event',
      correlationKey: run.id,
    });
    await store.updateRun(run.id, { status: 'waiting' });
    const retry = await processDomainEvent(deps, callback.id);
    expect(retry.waitsResumed).toBe(1);
    expect(retry.runsCreated).toBe(0);
    expect(record).toEqual(['after-hook']);
  });

  it('stops deferring after the cap and falls through to matching', async () => {
    const store = createMemoryStore();
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'w', type: 'wait.external', config: { timeoutHours: 24 } },
          { id: 'a', type: 'action.record', config: { label: 'after-hook' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );
    const deps = { store, registry, db: {} };
    const trigger = await enqueueTag(store, TAG);
    await store.markEvent(trigger.id, 'processed');
    const run = await store.insertRun({
      accountId: 'acct-1',
      automationId: auto.id,
      versionId: auto.publishedVersionId!,
      contactId: 'contact-1',
      triggerEventId: trigger.id,
      currentNodeId: 'w',
      context: {},
    });
    await store.updateRun(run.id, { status: 'running' });
    const callback = await callbackEvent(store, {
      runId: run.id,
      automationId: auto.id,
    });
    // Exhaust the deferral budget by re-claiming; each claim bumps attempts.
    for (let i = 0; i < 10; i++) {
      await store.claimPendingEvents(1, new Date(Date.now() + (i + 1) * 60_000));
      await store.deferEvent(callback.id, new Date(0));
    }
    const result = await processDomainEvent(deps, callback.id);
    // Broken flow becomes visible instead of looping forever.
    expect((await store.getEvent(callback.id))?.status).toBe('processed');
    expect(result.waitsResumed).toBe(0);
  });

  it('reclaims a stale claimed wait instead of losing the callback', async () => {
    const tick = clock(new Date('2026-01-01T00:00:00Z'));
    const store = createMemoryStore(tick.now);
    const record: string[] = [];
    const registry = makeRegistry([], record);
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'w', type: 'wait.external', config: { timeoutHours: 24 } },
          { id: 'a', type: 'action.record', config: { label: 'after-hook' } },
        ],
        [
          { source: 't', target: 'w' },
          { source: 'w', target: 'a' },
        ]
      )
    );
    const deps = { store, registry, db: {}, now: tick.now };
    await processDomainEvent(deps, (await enqueueTag(store, TAG)).id);
    const waiting = await store.findActiveRun(auto.id, 'contact-1');
    expect(waiting?.status).toBe('waiting');

    // Simulate the crash window: wait claimed, run never resumed.
    const claimed = await store.claimEventWait({
      accountId: 'acct-1',
      correlationKey: waiting!.id,
      automationId: auto.id,
    });
    expect(claimed?.status).toBe('claimed');

    // A fresh callback inside the lease is still a duplicate.
    const early = await callbackEvent(store, {
      runId: waiting!.id,
      automationId: auto.id,
    });
    expect((await processDomainEvent(deps, early.id)).waitsResumed).toBe(0);
    expect(record).toEqual([]);

    // Past the lease, the orphan is reclaimed and the run resumes.
    tick.advance(6 * 60_000);
    const late = await callbackEvent(store, {
      runId: waiting!.id,
      automationId: auto.id,
    });
    const result = await processDomainEvent(deps, late.id);
    expect(result.waitsResumed).toBe(1);
    expect(record).toEqual(['after-hook']);
    expect((await store.getRun(waiting!.id))?.status).toBe('completed');
  });
});
