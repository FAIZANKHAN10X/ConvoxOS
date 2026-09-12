import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const emptyConfig = z.object({});

function simpleTrigger(
  type: string,
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

export const taskCreatedTrigger = simpleTrigger(
  'trigger.task_created',
  'Task created',
  'Starts when a follow-up task is created for the contact',
  'When a task is created',
  DOMAIN_EVENT.TASK_CREATED
);

export const taskCompletedTrigger = simpleTrigger(
  'trigger.task_completed',
  'Task completed',
  'Starts when a contact task is marked complete',
  'When a task is completed',
  DOMAIN_EVENT.TASK_COMPLETED
);

export const taskOverdueTrigger = simpleTrigger(
  'trigger.task_overdue',
  'Task overdue',
  'Starts when an open task passes its due date',
  'When a task becomes overdue',
  DOMAIN_EVENT.TASK_OVERDUE
);

export const noteAddedTrigger = simpleTrigger(
  'trigger.note_added',
  'Note added',
  'Starts when a note is added to the contact',
  'When a note is added',
  DOMAIN_EVENT.NOTE_ADDED
);
