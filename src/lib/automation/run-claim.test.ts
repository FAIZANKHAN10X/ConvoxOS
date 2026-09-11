import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { STALE_RUNNING_RUN_CLAIM_MS } from './constants';
import { executeRun } from './engine';
import { graphFromNodes } from './graph';
import { createMemoryStore } from './memory-store';
import { builtinNodes } from './nodes/index';
import { disableAutomation, publishAutomation, saveDraft } from './publish';
import { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { DomainEvent } from './types';

function makeRegistry(record: string[]): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of builtinNodes) registry.register(node);
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
  return registry;
}

async function seedPublished(
  store: AutomationStore,
  registry: NodeRegistry,
  graph: ReturnType<typeof graphFromNodes>
) {
  const auto = await store.insertAutomation({
    accountId: 'acct-1',
    createdBy: 'user-1',
    name: 'Claim test',
  });
  await saveDraft(store, auto.id, graph);
  return publishAutomation(store, registry, auto.id, 'user-1');
}

function seedEvent(store: AutomationStore, key: string): Promise<DomainEvent> {
  return store.insertEvent({
    accountId: 'acct-1',
    eventType: 'tag_added',
    contactId: 'contact-1',
    payload: {},
    idempotencyKey: key,
  });
}

function deps(store: AutomationStore, record: string[], now = () => new Date()) {
  return { store, registry: makeRegistry(record), db: {}, now };
}

const graph = () =>
  graphFromNodes(
    [
      {
        id: 't',
        type: 'trigger.tag_added',
        config: { tagId: '11111111-1111-1111-1111-111111111111' },
      },
      { id: 'n', type: 'action.record', config: { label: 'ran' } },
    ],
    [
      { source: 't', target: 'n' },
    ]
  );

describe('claimRunForExecution mutual exclusion', () => {
  it('exactly one claimant wins; the loser does not execute', async () => {
    const record: string[] = [];
    const store = createMemoryStore();
    const d = deps(store, record);
    await seedPublished(store, d.registry, graph());
    const event = await seedEvent(store, 'e1');
    const auto = (await store.listPublishedTriggers('acct-1'))[0];
    const run = await store.insertRun({
      accountId: 'acct-1',
      automationId: auto.automationId,
      versionId: auto.versionId,
      contactId: 'contact-1',
      triggerEventId: event.id,
      currentNodeId: 't',
      context: { eventId: event.id, outputs: {} },
    });

    const first = await store.claimRunForExecution(run.id, new Date());
    expect(first?.status).toBe('running');
    // Second claimant loses the race.
    const second = await store.claimRunForExecution(run.id, new Date());
    expect(second).toBeNull();

    // Loser path through executeRun returns the row without executing.
    const before = record.length;
    const returned = await executeRun(d, run.id);
    expect(returned?.id).toBe(run.id);
    expect(record.length).toBe(before);
  });

  it('kick racing the cron executes the run exactly once', async () => {
    const record: string[] = [];
    const store = createMemoryStore();
    const d = deps(store, record);
    await seedPublished(store, d.registry, graph());
    const event = await seedEvent(store, 'e2');
    const auto = (await store.listPublishedTriggers('acct-1'))[0];
    const run = await store.insertRun({
      accountId: 'acct-1',
      automationId: auto.automationId,
      versionId: auto.versionId,
      contactId: 'contact-1',
      triggerEventId: event.id,
      currentNodeId: 't',
      context: { eventId: event.id, outputs: {} },
    });

    // Cron claims first (SKIP LOCKED), executes with skipClaim.
    const [claimed] = await store.claimDueRuns(10, new Date());
    expect(claimed.id).toBe(run.id);
    await executeRun(d, run.id, { skipClaim: true });
    // Late kick arrives while/after execution: must not re-execute.
    await executeRun(d, run.id);
    expect(record.filter((l) => l === 'ran').length).toBe(1);
  });

  it('reclaims a stale running run orphaned by a crash', async () => {
    const store = createMemoryStore(() => new Date('2026-01-01T00:00:00Z'));
    const run = await store.insertRun({
      accountId: 'a',
      automationId: 'auto',
      versionId: 'v',
      contactId: 'c',
      currentNodeId: null,
      context: {},
    });
    // Simulate a crash: running with an ancient heartbeat.
    await store.updateRun(run.id, { status: 'running' });
    const stale = new Date(
      new Date('2026-01-01T00:00:00Z').getTime() +
        STALE_RUNNING_RUN_CLAIM_MS +
        1000
    );
    const claimed = await store.claimDueRuns(10, stale);
    expect(claimed.map((r) => r.id)).toContain(run.id);

    // A healthy running run is NOT stolen.
    const fresh = await store.insertRun({
      accountId: 'a',
      automationId: 'auto2',
      versionId: 'v',
      contactId: 'c2',
      currentNodeId: null,
      context: {},
    });
    await store.updateRun(fresh.id, { status: 'running' });
    const claimed2 = await store.claimDueRuns(
      10,
      new Date('2026-01-01T00:00:01Z')
    );
    expect(claimed2.map((r) => r.id)).not.toContain(fresh.id);
  });

  it('reclaims a stale claimed wait and cancels claimed waits on cancel', async () => {
    const clock = { t: new Date('2026-01-01T00:00:00Z').getTime() };
    const store = createMemoryStore(() => new Date(clock.t));
    const wait = await store.insertWait({
      accountId: 'a',
      runId: 'run-1',
      nodeId: 'n',
      resumeNodeId: 'm',
      resumeAt: new Date(clock.t - 1000).toISOString(),
      kind: 'time',
    });
    const [claimed] = await store.claimDueWaits(
      10,
      new Date(clock.t)
    );
    expect(claimed.id).toBe(wait.id);
    // Crash before resume: immediately re-claiming finds nothing…
    expect(
      await store.claimDueWaits(10, new Date(clock.t + 1000))
    ).toEqual([]);
    // …but after the 5-minute lease the wait is reclaimed.
    clock.t += 6 * 60 * 1000;
    const reclaimed = await store.claimDueWaits(10, new Date(clock.t));
    expect(reclaimed.map((w) => w.id)).toContain(wait.id);

    // cancelRun path covers claimed waits, not just pending.
    await store.cancelWaitsForRun('run-1');
    expect(await store.claimDueWaits(10, new Date(clock.t))).toEqual([]);
  });

  it('a terminal run is never claimed', async () => {
    const store = createMemoryStore();
    const run = await store.insertRun({
      accountId: 'a',
      automationId: 'auto',
      versionId: 'v',
      contactId: 'c',
      currentNodeId: null,
      context: {},
    });
    await store.updateRun(run.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    expect(await store.claimRunForExecution(run.id, new Date())).toBeNull();
  });

  it('disableAutomation used for publish race guard', async () => {
    const record: string[] = [];
    const store = createMemoryStore();
    const d = deps(store, record);
    const published = await seedPublished(store, d.registry, graph());
    expect(published.status).toBe('published');
    await disableAutomation(store, published.id);
    expect((await store.getAutomation(published.id))?.status).toBe(
      'disabled'
    );
  });
});
