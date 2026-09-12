import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const emptyConfig = z.object({});

function lifecycleTrigger(
  type:
    | 'trigger.email_delivered'
    | 'trigger.email_bounced'
    | 'trigger.email_opened',
  label: string,
  description: string,
  summary: string,
  eventType: string
): NodeDefinition<z.infer<typeof emptyConfig>> {
  return {
    type,
    kind: 'trigger',
    label,
    description,
    category: 'trigger',
    configSchema: emptyConfig,
    summarize() {
      return summary;
    },
    match(event: DomainEvent) {
      return event.eventType === eventType;
    },
  };
}

export const emailDeliveredTrigger = lifecycleTrigger(
  'trigger.email_delivered',
  'Email delivered',
  'Starts when our email reaches the inbox',
  'When an email is delivered',
  DOMAIN_EVENT.EMAIL_DELIVERED
);

export const emailBouncedTrigger = lifecycleTrigger(
  'trigger.email_bounced',
  'Email bounced',
  'Starts when our email bounces or is complained about',
  'When an email bounces',
  DOMAIN_EVENT.EMAIL_BOUNCED
);

export const emailOpenedTrigger = lifecycleTrigger(
  'trigger.email_opened',
  'Email opened',
  'Starts when the contact opens our email',
  'When an email is opened',
  DOMAIN_EVENT.EMAIL_OPENED
);
