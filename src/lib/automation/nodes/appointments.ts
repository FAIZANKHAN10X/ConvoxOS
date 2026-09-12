import { z } from 'zod';

import { DOMAIN_EVENT } from '../event-types';
import type { DomainEvent, NodeDefinition } from '../types';

const emptyConfig = z.object({});

function statusTrigger(
  type:
    | 'trigger.appointment_booked'
    | 'trigger.appointment_confirmed'
    | 'trigger.appointment_cancelled'
    | 'trigger.appointment_completed',
  label: string,
  description: string,
  summary: string,
  status: 'booked' | 'confirmed' | 'cancelled' | 'completed'
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
      return (
        event.eventType === DOMAIN_EVENT.APPOINTMENT_STATUS_CHANGED &&
        event.payload.to_status === status
      );
    },
  };
}

export const appointmentBookedTrigger = statusTrigger(
  'trigger.appointment_booked',
  'Appointment booked',
  'Starts when an appointment is booked for the contact',
  'When an appointment is booked',
  'booked'
);

export const appointmentConfirmedTrigger = statusTrigger(
  'trigger.appointment_confirmed',
  'Appointment confirmed',
  'Starts when the contact confirms an appointment',
  'When an appointment is confirmed',
  'confirmed'
);

export const appointmentCancelledTrigger = statusTrigger(
  'trigger.appointment_cancelled',
  'Appointment cancelled',
  'Starts when an appointment is cancelled',
  'When an appointment is cancelled',
  'cancelled'
);

export const appointmentCompletedTrigger = statusTrigger(
  'trigger.appointment_completed',
  'Appointment completed',
  'Starts when an appointment is completed',
  'When an appointment is completed',
  'completed'
);
