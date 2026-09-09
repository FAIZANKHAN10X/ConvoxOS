import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const tagAddedConfig = z.object({
  tagId: z.string().uuid(),
});

export const tagAddedTrigger: NodeDefinition<z.infer<typeof tagAddedConfig>> = {
  type: 'trigger.tag_added',
  kind: 'trigger',
  label: 'Tag added',
  description: 'Starts when a tag is added to a contact',
  category: 'trigger',
  configSchema: tagAddedConfig,
  summarize() {
    return 'When a tag is added';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.TAG_ADDED) return false;
    const tagId = event.payload.tag_id;
    return typeof tagId === 'string' && tagId === config.tagId;
  },
};
