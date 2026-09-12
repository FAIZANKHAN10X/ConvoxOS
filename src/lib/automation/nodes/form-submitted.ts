import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const formSubmittedConfig = z.object({
  formId: z.string().uuid().optional(),
});

export const formSubmittedTrigger: NodeDefinition<
  z.infer<typeof formSubmittedConfig>
> = {
  type: 'trigger.form_submitted',
  kind: 'trigger',
  label: 'Form submitted',
  description: 'Starts when a lead-capture form is submitted',
  category: 'trigger',
  configSchema: formSubmittedConfig,
  summarize() {
    return 'When a form is submitted';
  },
  match(event: DomainEvent, config) {
    if (event.eventType !== DOMAIN_EVENT.FORM_SUBMITTED) return false;
    if (
      config.formId &&
      typeof event.payload.form_id === 'string' &&
      event.payload.form_id !== config.formId
    ) {
      return false;
    }
    return true;
  },
};
