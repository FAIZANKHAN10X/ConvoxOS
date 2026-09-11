import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const dealStageChangedConfig = z.object({
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
});

export const dealStageChangedTrigger: NodeDefinition<
  z.infer<typeof dealStageChangedConfig>
> = {
  type: 'trigger.deal_stage_changed',
  kind: 'trigger',
  label: 'Deal stage changed',
  description: 'Starts when a deal moves to another stage',
  category: 'trigger',
  configSchema: dealStageChangedConfig,
  summarize() {
    return 'When a deal changes stage';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.DEAL_STAGE_CHANGED) return false;
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
      typeof payload.to_stage_id === 'string' &&
      payload.to_stage_id !== config.stageId
    ) {
      return false;
    }
    return true;
  },
};
