import { MAX_EVENT_CHAIN_DEPTH } from './constants';
import { nodeConfig, triggerNodes } from './graph';
import type { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { DomainEvent, PublishedTrigger } from './types';

export interface TriggerMatch {
  trigger: PublishedTrigger;
  /**
   * T5.5: the graph trigger node that matched. An automation may
   * carry several triggers (OR semantics) — the run starts at the
   * matched node, and repeat matches for the same event collapse
   * in the T5.4 enrollment gate.
   */
  nodeId: string;
}

/**
 * Match a durable event to published automations. Chain depth is the
 * only loop brake: automation-generated events increment depth, and
 * matching stops at MAX_EVENT_CHAIN_DEPTH. Every trigger node in the
 * published graph is evaluated (T5.5 multi-trigger); the version's
 * denormalized `trigger` field is display-only.
 */
export async function matchTriggers(
  store: AutomationStore,
  registry: NodeRegistry,
  event: DomainEvent
): Promise<TriggerMatch[]> {
  if (event.chainDepth >= MAX_EVENT_CHAIN_DEPTH) return [];
  if (!event.contactId) return [];

  const published = await store.listPublishedTriggers(event.accountId);
  const matches: TriggerMatch[] = [];

  for (const trigger of published) {
    for (const node of triggerNodes(trigger.version.graph)) {
      const def = registry.get(node.type);
      if (!def || def.kind !== 'trigger' || !def.match) continue;

      const parsed = def.configSchema.safeParse(nodeConfig(node));
      if (!parsed.success) continue;
      if (
        !def.match(event, parsed.data, { automationId: trigger.automationId })
      )
        continue;

      matches.push({ trigger, nodeId: node.id });
    }
  }

  return matches;
}
