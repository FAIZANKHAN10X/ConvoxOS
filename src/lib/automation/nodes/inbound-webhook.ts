import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const inboundWebhookConfig = z.object({
  hookId: z.string().uuid(),
});

export type InboundWebhookConfig = z.infer<typeof inboundWebhookConfig>;

/**
 * Starts when an external system POSTs to this automation's inbound
 * hook (`/api/hooks/<token>`) with a valid HMAC signature. Matching
 * is by hook row — an event fired at hook A never starts the
 * automation holding hook B.
 */
export const inboundWebhookTrigger: NodeDefinition<
  z.infer<typeof inboundWebhookConfig>
> = {
  type: 'trigger.inbound_webhook',
  kind: 'trigger',
  label: 'Inbound webhook',
  description: 'Starts when an external system calls this automation',
  category: 'trigger',
  configSchema: inboundWebhookConfig,
  summarize() {
    return 'When an external webhook arrives';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.EXTERNAL_RECEIVED) return false;
    const hookId = event.payload.hook_id;
    return typeof hookId === 'string' && hookId === config.hookId;
  },
};
