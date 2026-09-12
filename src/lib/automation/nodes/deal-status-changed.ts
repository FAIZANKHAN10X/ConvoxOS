import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const dealStatusChangedConfig = z.object({
  toStatus: z.enum(['open', 'won', 'lost']).optional(),
});

export const dealStatusChangedTrigger: NodeDefinition<
  z.infer<typeof dealStatusChangedConfig>
> = {
  type: 'trigger.deal_status_changed',
  kind: 'trigger',
  label: 'Deal status changed',
  description: 'Starts when a deal moves between open, won, and lost',
  category: 'trigger',
  configSchema: dealStatusChangedConfig,
  summarize() {
    return 'When a deal status changes';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.DEAL_STATUS_CHANGED) return false;
    if (
      config.toStatus &&
      typeof event.payload.to_status === 'string' &&
      event.payload.to_status !== config.toStatus
    ) {
      return false;
    }
    return true;
  },
};

const emptyConfig = z.object({});

function statusTrigger(
  type: 'trigger.deal_won' | 'trigger.deal_lost',
  label: string,
  description: string,
  summary: string,
  status: 'won' | 'lost'
): NodeDefinition<z.infer<typeof emptyConfig>> {
  return {
    type,
    kind: 'trigger',
    label,
    description,
    category: 'trigger',
    configSchema: emptyConfig,
    summarize() {
      return summary;
    },
    match(event: DomainEvent) {
      return (
        event.eventType === DOMAIN_EVENT.DEAL_STATUS_CHANGED &&
        event.payload.to_status === status
      );
    },
  };
}

export const dealWonTrigger = statusTrigger(
  'trigger.deal_won',
  'Deal won',
  'Starts when a deal is marked won',
  'When a deal is won',
  'won'
);

export const dealLostTrigger = statusTrigger(
  'trigger.deal_lost',
  'Deal lost',
  'Starts when a deal is marked lost',
  'When a deal is lost',
  'lost'
);
