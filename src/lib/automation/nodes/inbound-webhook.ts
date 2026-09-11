import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { AutomationGraph, DomainEvent, NodeDefinition } from '../types';

const inboundWebhookConfig = z.object({
  hookId: z.preprocess(
    (value) => (typeof value === 'string' && value.length > 0 ? value : undefined),
    z.string().uuid().optional()
  ),
});

export type InboundWebhookConfig = z.infer<typeof inboundWebhookConfig>;

export const INBOUND_WEBHOOK_TYPE = 'trigger.inbound_webhook';

/**
 * Stamp this automation's inbound hook onto the draft trigger so a
 * valid POST cannot 202 with zero runs because hookId was never set.
 */
export function bindHookIdInGraph(
  graph: AutomationGraph,
  hookId: string
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type !== INBOUND_WEBHOOK_TYPE) return node;
      return {
        ...node,
        data: {
          ...node.data,
          config: { ...(node.data?.config ?? {}), hookId },
        },
      };
    }),
  };
}

/**
 * Starts when an external system POSTs to this automation's inbound
 * hook (`/api/hooks/<token>`) with a valid HMAC signature. Matching
 * is by hook row when configured, and otherwise by the hook's
 * automation_id (one hook per automation).
 */
export const inboundWebhookTrigger: NodeDefinition<
  z.infer<typeof inboundWebhookConfig>
> = {
  type: INBOUND_WEBHOOK_TYPE,
  kind: 'trigger',
  label: 'Inbound webhook',
  description: 'Starts when an external system calls this automation',
  category: 'trigger',
  configSchema: inboundWebhookConfig,
  summarize() {
    return 'When an external webhook arrives';
  },
  match(event: DomainEvent, config, ctx) {
    if (event.eventType !== DOMAIN_EVENT.EXTERNAL_RECEIVED) return false;
    const hookId = event.payload.hook_id;
    if (config.hookId && typeof hookId === 'string' && hookId === config.hookId) {
      return true;
    }
    const automationId = event.payload.automation_id;
    return (
      typeof automationId === 'string' &&
      !!ctx?.automationId &&
      automationId === ctx.automationId
    );
  },
};
