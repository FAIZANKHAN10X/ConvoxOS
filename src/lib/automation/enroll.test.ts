import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createRunFromMatch } from './engine';
import { evaluateEnrollment } from './enroll';
import { graphFromNodes } from './graph';
import { createMemoryStore } from './memory-store';
import { builtinNodes } from './nodes/index';
import { disableAutomation, publishAutomation, saveDraft } from './publish';
import { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { AutomationRun, DomainEvent } from './types';
import { processDomainEvent } from './worker';

const TAG = '11111111-1111-1111-1111-111111111111';

function makeRegistry(): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of builtinNodes) registry.register(node);
  registry.register({
    type: 'action.record',
    kind: 'action',
    label: 'Record',
    description: 'Test spy',
    category: 'crm',
    configSchema: z.object({ label: z.string() }),
    execute() {
      return { status: 'ok', output: {} };
    },
  });
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

function enqueue(
  store: AutomationStore,
  eventType: string,
  payload: Record<string, unknown> = {},
  idempotencyKey?: string
): Promise<DomainEvent> {
  return store.insertEvent({
    accountId: 'acct-1',
    eventType,
    contactId: 'contact-1',
    payload,
    idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    chainDepth: 0,
    source: 'crm',
  });
}

const run = (overrides: Partial<AutomationRun> = {}): AutomationRun => ({
  id: 'run-1',
  accountId: 'acct-1',
  automationId: 'auto-1',
  versionId: 'v1',
  contactId: 'contact-1',
  triggerEventId: null,
  status: 'running',
  currentNodeId: null,
  nodeExecutions: 0,
  attempt: 1,
  context: {},
  lastError: null,
  waitUntil: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  ...overrides,
});

describe('evaluateEnrollment gate', () => {
  it('enrolls repeat contacts with no active run', () => {
    expect(
      evaluateEnrollment({ reentryPolicy: 'repeat', activeRun: null, priorRun: false })
    ).toEqual({ decision: 'enroll' });
  });

  it('skips on active runs under either policy', () => {
    for (const reentryPolicy of ['once', 'repeat'] as const) {
      expect(
        evaluateEnrollment({ reentryPolicy, activeRun: run(), priorRun: false })
      ).toMatchObject({ decision: 'skip', reason: 'active_run' });
    }
  });

  it('blocks re-entry under once, allows under repeat', () => {
    expect(
      evaluateEnrollment({ reentryPolicy: 'once', activeRun: null, priorRun: true })
    ).toMatchObject({ decision: 'skip', reason: 'already_enrolled' });
    expect(
      evaluateEnrollment({ reentryPolicy: 'repeat', activeRun: null, priorRun: true })
    ).toEqual({ decision: 'enroll' });
  });
});

describe('once re-entry policy', () => {
  it('blocks a second enrollment after the first run completes', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
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
    await store.updateAutomation(auto.id, { reentryPolicy: 'once' });
    const deps = { store, registry, db: {} };

    const first = await createRunFromMatch(
      deps,
      await enqueue(store, 'tag_added', { tag_id: TAG }),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        reentryPolicy: 'once',
      }
    );
    expect(first?.status).toBe('queued');
    // Terminal run, no active run — repeat would enroll, once blocks.
    await store.updateRun(first!.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    const second = await createRunFromMatch(
      deps,
      await enqueue(store, 'tag_added', { tag_id: TAG }, 'e2'),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        reentryPolicy: 'once',
      }
    );
    expect(second).toBeNull();
    expect(store.skips).toHaveLength(1);
    expect(store.skips[0]).toMatchObject({
      automationId: auto.id,
      contactId: 'contact-1',
      reason: 'already_enrolled',
    });

    // The re-read path takes policy from the automation row
    // (production: always consistent with the carried trigger).
    // Flip the row back to repeat for a repeat enrollment.
    await store.updateAutomation(auto.id, { reentryPolicy: 'repeat' });
    const third = await createRunFromMatch(
      deps,
      await enqueue(store, 'tag_added', { tag_id: TAG }, 'e3'),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        reentryPolicy: 'repeat',
      }
    );
    expect(third?.status).toBe('queued');
  });
});

describe('stop on reply', () => {
  const waitGraph = graphFromNodes(
    [
      { id: 't', type: 'trigger.message_received', config: { channel: 'any' } },
      { id: 'w', type: 'timing.wait', config: { amount: 1, unit: 'days' } },
    ],
    [{ source: 't', target: 'w' }]
  );

  it('cancels active runs before enrolling from the reply', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(store, registry, waitGraph);
    await store.updateAutomation(auto.id, { stopOnReply: true });
    const deps = { store, registry, db: {} };

    // Seed an active run from an earlier event (queued, unexecuted).
    const seed = await createRunFromMatch(
      deps,
      await enqueue(store, 'message_received', {}, 'seed'),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        version: undefined,
        reentryPolicy: 'repeat',
      }
    );
    expect(seed?.status).toBe('queued');

    // The reply cancels the seeded run, then enrolls fresh (which
    // parks at the wait node, staying active for the assertion).
    await processDomainEvent(deps, (await enqueue(store, 'message_received', {}, 'reply')).id);

    const cancelled = await store.getRun(seed!.id);
    expect(cancelled?.status).toBe('cancelled');
    const fresh = await store.findActiveRun(auto.id, 'contact-1');
    expect(fresh).not.toBeNull();
    expect(fresh?.id).not.toBe(seed!.id);
    expect(fresh?.status).toBe('waiting');
  });

  it('leaves runs alone when stop_on_reply is off', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(store, registry, waitGraph);
    const deps = { store, registry, db: {} };

    const seed = await createRunFromMatch(
      deps,
      await enqueue(store, 'message_received', {}, 'seed'),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        reentryPolicy: 'repeat',
      }
    );
    await processDomainEvent(deps, (await enqueue(store, 'message_received', {}, 'reply')).id);

    // Conflict: the reply enrolls nothing. The worker still picks
    // up the seed as a due run and parks it at the wait node — the
    // seed keeps progressing normally, unenrolled-from-reply. Two
    // skips land: the reply event plus the trailing sweep
    // re-processing the seed event itself, both active_run.
    const kept = await store.getRun(seed!.id);
    expect(kept?.status).toBe('waiting');
    expect(store.skips).toHaveLength(2);
    expect(store.skips.every((s) => s.reason === 'active_run')).toBe(true);
  });
});

describe('automation disable', () => {
  it('still declines enrollment for disabled automations', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
          { id: 'w', type: 'timing.wait', config: { amount: 1, unit: 'days' } },
        ],
        [{ source: 't', target: 'w' }]
      )
    );
    await disableAutomation(store, auto.id);
    const deps = { store, registry, db: {} };
    const run = await createRunFromMatch(
      deps,
      await enqueue(store, 'tag_added', { tag_id: TAG }),
      { automationId: auto.id, versionId: auto.publishedVersionId! }
    );
    expect(run).toBeNull();
  });
});
