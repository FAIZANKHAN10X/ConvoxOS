import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const config = z.object({
  tagId: z.string().uuid(),
});

export const tagRemovedTrigger: NodeDefinition<z.infer<typeof config>> = {
  type: 'trigger.tag_removed',
  kind: 'trigger',
  label: 'Tag removed',
  description: 'Starts when a tag is removed from a contact',
  category: 'trigger',
  configSchema: config,
  summarize() {
    return 'When a tag is removed';
  },
  match(event: DomainEvent, value) {
    if (event.eventType !== DOMAIN_EVENT.TAG_REMOVED) return false;
    return event.payload.tag_id === value.tagId;
  },
};
