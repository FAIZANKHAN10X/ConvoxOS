import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const dealUpdatedConfig = z.object({
  /** Optional field filter — matches when any listed field changed.
   * Empty means any update. Field names mirror the writer output
   * (title, value, currency, assigned_to, notes, expected_close_date). */
  fields: z.array(z.string().min(1).max(64)).max(10).optional(),
});

export const dealUpdatedTrigger: NodeDefinition<
  z.infer<typeof dealUpdatedConfig>
> = {
  type: 'trigger.deal_updated',
  kind: 'trigger',
  label: 'Deal updated',
  description: 'Starts when a deal field (title, value, …) changes',
  category: 'trigger',
  configSchema: dealUpdatedConfig,
  summarize() {
    return 'When a deal is updated';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.DEAL_UPDATED) return false;
    if (!config.fields || config.fields.length === 0) return true;
    const changed = event.payload.fields;
    if (!Array.isArray(changed)) return false;
    return config.fields.some((f) => changed.includes(f));
  },
};
