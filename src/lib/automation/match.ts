import { MAX_EVENT_CHAIN_DEPTH } from './constants';
import type { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import type { DomainEvent, PublishedTrigger } from './types';

export interface TriggerMatch {
  trigger: PublishedTrigger;
}

/**
 * Match a durable event to published automations. Chain depth is the
 * only loop brake: automation-generated events increment depth, and
 * matching stops at MAX_EVENT_CHAIN_DEPTH.
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
    const def = registry.get(trigger.trigger.type);
    if (!def || def.kind !== 'trigger' || !def.match) continue;

    const parsed = def.configSchema.safeParse(trigger.trigger.config);
    if (!parsed.success) continue;
    if (!def.match(event, parsed.data, { automationId: trigger.automationId }))
      continue;

    matches.push({ trigger });
  }

  return matches;
}
