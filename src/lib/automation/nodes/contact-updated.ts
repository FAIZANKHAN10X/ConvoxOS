import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const config = z.object({});

export const contactUpdatedTrigger: NodeDefinition<z.infer<typeof config>> = {
  type: 'trigger.contact_updated',
  kind: 'trigger',
  label: 'Contact updated',
  description: 'Starts when any contact field changes',
  category: 'trigger',
  configSchema: config,
  summarize() {
    return 'When a contact is updated';
  },
  match(event: DomainEvent) {
    return event.eventType === DOMAIN_EVENT.CONTACT_UPDATED;
  },
};
