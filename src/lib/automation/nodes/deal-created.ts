import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const dealCreatedConfig = z.object({
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
});

export const dealCreatedTrigger: NodeDefinition<
  z.infer<typeof dealCreatedConfig>
> = {
  type: 'trigger.deal_created',
  kind: 'trigger',
  label: 'Deal created',
  description: 'Starts when a new opportunity is created',
  category: 'trigger',
  configSchema: dealCreatedConfig,
  summarize() {
    return 'When a deal is created';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.DEAL_CREATED) return false;
    const payload = event.payload;
    if (
      config.pipelineId &&
      typeof payload.pipeline_id === 'string' &&
      payload.pipeline_id !== config.pipelineId
    ) {
      return false;
    }
    if (
      config.stageId &&
      typeof payload.stage_id === 'string' &&
      payload.stage_id !== config.stageId
    ) {
      return false;
    }
    return true;
  },
};
