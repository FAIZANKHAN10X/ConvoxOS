import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const config = z.object({
  source: z.enum(['any', 'inbound', 'manual', 'api']).default('any'),
});

export const contactCreatedTrigger: NodeDefinition<z.infer<typeof config>> = {
  type: 'trigger.contact_created',
  kind: 'trigger',
  label: 'Contact created',
  description: 'Starts when a new contact is created',
  category: 'trigger',
  configSchema: config,
  summarize(value) {
    return value.source === 'any' ? 'Any source' : `Source: ${value.source}`;
  },
  match(event: DomainEvent, value) {
    if (event.eventType !== DOMAIN_EVENT.CONTACT_CREATED) return false;
    if (value.source === 'any') return true;
    return event.payload.source === value.source;
  },
};
