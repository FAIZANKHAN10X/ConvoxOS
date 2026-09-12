import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateDraftGraph } from './client-validate';
import { createRunFromMatch } from './engine';
import { graphFromNodes } from './graph';
import { matchTriggers } from './match';
import { createMemoryStore } from './memory-store';
import { builtinNodes } from './nodes/index';
import { dealUpdatedTrigger } from './nodes/deal-updated';
import { publishAutomation, saveDraft } from './publish';
import { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { DomainEvent } from './types';
import { validateGraph } from './validate';
import { processDomainEvent } from './worker';
import { DOMAIN_EVENT } from './event-types';

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
  graph: ReturnType<typeof graphFromNodes>
) {
  const auto = await store.insertAutomation({
    accountId: 'acct-1',
    createdBy: 'user-1',
    name: 'Multi',
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

const multiGraph = () =>
  graphFromNodes(
    [
      { id: 't1', type: 'trigger.tag_added', config: { tagId: TAG } },
      { id: 't2', type: 'trigger.contact_updated', config: {} },
      { id: 'w', type: 'timing.wait', config: { amount: 1, unit: 'days' } },
    ],
    [
      { source: 't1', target: 'w' },
      { source: 't2', target: 'w' },
    ]
  );

describe('multi-trigger matching', () => {
  it('evaluates every trigger node (OR semantics)', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    await seedPublished(store, registry, multiGraph());

    const tagEvent = await enqueue(store, 'tag_added', { tag_id: TAG }, 'e1');
    const tagMatches = await matchTriggers(store, registry, tagEvent);
    expect(tagMatches).toHaveLength(1);
    expect(tagMatches[0].nodeId).toBe('t1');

    const updateEvent = await enqueue(
      store,
      'contact_updated',
      { fields: ['name'] },
      'e2'
    );
    const updateMatches = await matchTriggers(store, registry, updateEvent);
    expect(updateMatches).toHaveLength(1);
    expect(updateMatches[0].nodeId).toBe('t2');
  });

  it('starts the run at the matched trigger node', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    const auto = await seedPublished(store, registry, multiGraph());
    const deps = { store, registry, db: {} };

    const run = await createRunFromMatch(
      deps,
      await enqueue(store, 'contact_updated', { fields: ['name'] }, 'e3'),
      {
        automationId: auto.id,
        versionId: auto.publishedVersionId!,
        entryNodeId: 't2',
      }
    );
    expect(run?.currentNodeId).toBe('t2');
    expect(run?.context).toMatchObject({
      enrollment: expect.objectContaining({ triggerNodeId: 't2' }),
    });
  });

  it('collapses repeat matches for one event into a single run', async () => {
    const store = createMemoryStore();
    const registry = makeRegistry();
    // Both triggers fire on the same contact_updated event.
    await seedPublished(
      store,
      registry,
      graphFromNodes(
        [
          { id: 't1', type: 'trigger.contact_updated', config: {} },
          { id: 't2', type: 'trigger.contact_updated', config: {} },
          { id: 'w', type: 'timing.wait', config: { amount: 1, unit: 'days' } },
        ],
        [
          { source: 't1', target: 'w' },
          { source: 't2', target: 'w' },
        ]
      )
    );
    const deps = { store, registry, db: {} };
    const event = await enqueue(store, 'contact_updated', { fields: ['name'] }, 'e4');

    const matches = await matchTriggers(store, registry, event);
    expect(matches).toHaveLength(2);

    await processDomainEvent(deps, event.id);
    // Exactly one run enrolled; the repeat match skipped deterministically.
    expect(store.skips).toHaveLength(1);
    expect(store.skips[0]).toMatchObject({ reason: 'active_run' });
  });
});

describe('multi-trigger validation', () => {
  it('server validation allows several triggers but requires one', () => {
    const registry = makeRegistry();
    expect(validateGraph(multiGraph(), registry)).toEqual([]);
    const none = graphFromNodes(
      [{ id: 'a', type: 'action.record', config: { label: 'x' } }],
      []
    );
    expect(
      validateGraph(none, registry).some((i) => i.path === 'graph')
    ).toBe(true);
  });

  it('client validation allows several triggers but requires one', async () => {
    const { catalogFromRegistry } = await import('./catalog');
    const catalog = catalogFromRegistry(makeRegistry());
    expect(validateDraftGraph(multiGraph(), catalog)).toEqual([]);
    const none = graphFromNodes(
      [{ id: 'a', type: 'action.record', config: { label: 'x' } }],
      []
    );
    expect(validateDraftGraph(none, catalog).length).toBeGreaterThan(0);
  });
});

describe('trigger.deal_updated', () => {
  const base: DomainEvent = {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.DEAL_UPDATED,
    contactId: 'contact-1',
    payload: { deal_id: 'deal-1', fields: ['title', 'value'] },
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

  it('matches any update, or only listed fields', () => {
    expect(dealUpdatedTrigger.match?.(base, {})).toBe(true);
    expect(dealUpdatedTrigger.match?.(base, { fields: ['value'] })).toBe(true);
    expect(dealUpdatedTrigger.match?.(base, { fields: ['notes'] })).toBe(false);
    expect(
      dealUpdatedTrigger.match?.(
        { ...base, eventType: DOMAIN_EVENT.DEAL_CREATED },
        {}
      )
    ).toBe(false);
  });

  it('is registered in the default registry', async () => {
    const { defaultRegistry } = await import('./registry');
    expect(defaultRegistry.require('trigger.deal_updated')).toBe(
      dealUpdatedTrigger
    );
  });
});
