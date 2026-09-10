import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import { CHANNEL_FIELD_LABELS } from '../present';
import type { DomainEvent, NodeDefinition } from '../types';

const config = z.object({
  channel: z.enum(['any', 'whatsapp', 'telegram']).default('any'),
});

export const messageReceivedTrigger: NodeDefinition<z.infer<typeof config>> = {
  type: 'trigger.message_received',
  kind: 'trigger',
  label: 'Message received',
  description: 'Starts when the contact sends any inbound message',
  category: 'trigger',
  fieldLabels: { channel: CHANNEL_FIELD_LABELS },
  configSchema: config,
  summarize(value) {
    return value.channel === 'any' ? 'Any channel' : `On ${value.channel}`;
  },
  match(event: DomainEvent, value) {
    if (event.eventType !== DOMAIN_EVENT.MESSAGE_RECEIVED) return false;
    if (value.channel === 'any') return true;
    return event.payload.channel === value.channel;
  },
};
