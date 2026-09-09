import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import { matchKeywords } from '../keywords';
import type { DomainEvent, NodeDefinition } from '../types';

const config = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(10),
  matchType: z
    .enum(['is', 'contains', 'contains_word', 'begins_with'])
    .default('contains'),
  channel: z.enum(['any', 'whatsapp', 'telegram']).default('any'),
});

export const keywordTrigger: NodeDefinition<z.infer<typeof config>> = {
  type: 'trigger.keyword',
  kind: 'trigger',
  label: 'Keyword',
  description: 'Starts when an inbound message matches a keyword rule',
  category: 'trigger',
  configSchema: config,
  summarize(value) {
    const sample = (value.keywords ?? []).slice(0, 3).join(', ');
    return sample ? `${value.matchType}: ${sample}` : 'Set keywords';
  },
  match(event: DomainEvent, value) {
    if (event.eventType !== DOMAIN_EVENT.MESSAGE_RECEIVED) return false;
    if (value.channel !== 'any' && event.payload.channel !== value.channel) {
      return false;
    }
    const text =
      typeof event.payload.text === 'string'
        ? event.payload.text
        : typeof event.payload.content_text === 'string'
          ? event.payload.content_text
          : '';
    return matchKeywords(text, value.keywords, value.matchType);
  },
};
