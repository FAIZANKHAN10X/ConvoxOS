import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createRunFromMatch } from './engine';
import { graphFromNodes } from './graph';
import { createMemoryStore } from './memory-store';
import { builtinNodes } from './nodes/index';
import { publishAutomation, saveDraft } from './publish';
import { NodeRegistry } from './registry';
import { matchTriggers } from './match';
import type { AutomationStore } from './store';

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
    configSchema: z.object({ label: z.string().default('x') }),
    execute() {
      return { status: 'ok', output: {} };
    },
  });
  return registry;
}

const graph = () =>
  graphFromNodes(
    [
      { id: 't', type: 'trigger.tag_added', config: { tagId: TAG } },
      { id: 'n', type: 'action.record', config: { label: 'ran' } },
    ],
    [{ source: 't', target: 'n' }]
  );

/** Wrap a store counting read calls (local proxy for DB round trips). */
function counting(base: AutomationStore, counts: Record<string, number>): AutomationStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof value === 'function' &&
        typeof prop === 'string' &&
        [
          'listPublishedTriggers',
          'getAutomation',
          'getVersion',
          'insertRun',
        ].includes(prop)
      ) {
        return (...args: unknown[]) => {
          counts[prop] = (counts[prop] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function seedMany(
  store: AutomationStore,
  registry: NodeRegistry,
  n: number
) {
  for (let i = 0; i < n; i++) {
    const auto = await store.insertAutomation({
      accountId: 'acct-1',
      createdBy: 'user-1',
      name: `Auto ${i}`,
    });
    await saveDraft(store, auto.id, graph());
    await publishAutomation(store, registry, auto.id, 'user-1');
  }
}

describe.each([5, 50])('trigger lookup efficiency (N=%i)', (n) => {
  it('match + create costs 1 list + 0 re-reads + N inserts', async () => {
    const counts: Record<string, number> = {};
    const inner = createMemoryStore();
    const store = counting(inner, counts);
    const registry = makeRegistry();
    await seedMany(store, registry, n);
    // Seeding itself reads (publish flow); measure only the hot path.
    for (const k of Object.keys(counts)) delete counts[k];

    const event = await store.insertEvent({
      accountId: 'acct-1',
      eventType: 'tag_added',
      contactId: `contact-${n}`,
      payload: { tag_id: TAG },
      idempotencyKey: `t1-${n}`,
    });

    const matches = await matchTriggers(store, registry, event);
    expect(matches.length).toBe(n);

    const deps = { store, registry, db: {} };
    for (const match of matches) {
      const run = await createRunFromMatch(deps, event, {
        automationId: match.trigger.automationId,
        versionId: match.trigger.versionId,
        version: match.trigger.version,
      });
      expect(run).not.toBeNull();
    }

    // T1.4: 1 list query, zero per-match re-reads, one insert per run.
    // Old path cost 2 list trips + 2 re-reads per match (2+2M reads);
    // carried versions eliminate the re-reads entirely.
    expect(counts.listPublishedTriggers).toBe(1);
    expect(counts.getAutomation ?? 0).toBe(0);
    expect(counts.getVersion ?? 0).toBe(0);
    expect(counts.insertRun).toBe(n);
  });

  it('falls back to re-read when no version is carried', async () => {
    const counts: Record<string, number> = {};
    const inner = createMemoryStore();
    const store = counting(inner, counts);
    const registry = makeRegistry();
    await seedMany(store, registry, 1);
    for (const k of Object.keys(counts)) delete counts[k];

    const event = await store.insertEvent({
      accountId: 'acct-1',
      eventType: 'tag_added',
      contactId: 'contact-fb',
      payload: { tag_id: TAG },
      idempotencyKey: `fb-${n}`,
    });
    const [match] = await matchTriggers(store, registry, event);
    const run = await createRunFromMatch(
      { store, registry, db: {} },
      event,
      {
        automationId: match.trigger.automationId,
        versionId: match.trigger.versionId,
      }
    );
    expect(run).not.toBeNull();
    expect(counts.getAutomation).toBe(1);
    expect(counts.getVersion).toBe(1);
  });
});
