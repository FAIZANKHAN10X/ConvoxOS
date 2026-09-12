import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent } from '../types';
import {
  appointmentBookedTrigger,
  appointmentCancelledTrigger,
  appointmentCompletedTrigger,
  appointmentConfirmedTrigger,
} from './appointments';
import './index';

function event(toStatus: string): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.APPOINTMENT_STATUS_CHANGED,
    contactId: 'contact-1',
    payload: { appointment_id: 'appt-1', to_status: toStatus },
    source: 'crm',
    originRunId: null,
    causationEventId: null,
    chainDepth: 0,
    idempotencyKey: 'k',
    status: 'pending',
    attempts: 0,
    availableAt: new Date().toISOString(),
    processedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

describe('appointment triggers', () => {
  it('routes on to_status', () => {
    expect(appointmentBookedTrigger.match?.(event('booked'), {})).toBe(true);
    expect(appointmentBookedTrigger.match?.(event('cancelled'), {})).toBe(false);
    expect(appointmentConfirmedTrigger.match?.(event('confirmed'), {})).toBe(true);
    expect(appointmentCancelledTrigger.match?.(event('cancelled'), {})).toBe(true);
    expect(appointmentCompletedTrigger.match?.(event('completed'), {})).toBe(true);
    expect(
      appointmentCompletedTrigger.match?.(
        { ...event('completed'), eventType: DOMAIN_EVENT.FORM_SUBMITTED },
        {}
      )
    ).toBe(false);
  });

  it('registers all appointment triggers', () => {
    for (const [type, node] of [
      ['trigger.appointment_booked', appointmentBookedTrigger],
      ['trigger.appointment_confirmed', appointmentConfirmedTrigger],
      ['trigger.appointment_cancelled', appointmentCancelledTrigger],
      ['trigger.appointment_completed', appointmentCompletedTrigger],
    ] as const) {
      expect(defaultRegistry.require(type)).toBe(node);
    }
  });
});
