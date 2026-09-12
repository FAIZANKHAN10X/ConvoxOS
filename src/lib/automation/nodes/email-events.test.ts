import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent } from '../types';
import {
  emailBouncedTrigger,
  emailDeliveredTrigger,
  emailOpenedTrigger,
} from './email-events';
import './index';

function event(type: string): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: type,
    contactId: 'contact-1',
    payload: { message_id: 'msg-1' },
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

describe('email lifecycle triggers', () => {
  it('matches each type only', () => {
    expect(
      emailDeliveredTrigger.match?.(event(DOMAIN_EVENT.EMAIL_DELIVERED), {})
    ).toBe(true);
    expect(
      emailDeliveredTrigger.match?.(event(DOMAIN_EVENT.EMAIL_OPENED), {})
    ).toBe(false);
    expect(
      emailBouncedTrigger.match?.(event(DOMAIN_EVENT.EMAIL_BOUNCED), {})
    ).toBe(true);
    expect(
      emailOpenedTrigger.match?.(event(DOMAIN_EVENT.EMAIL_OPENED), {})
    ).toBe(true);
  });

  it('registers all email triggers', () => {
    for (const [type, node] of [
      ['trigger.email_delivered', emailDeliveredTrigger],
      ['trigger.email_bounced', emailBouncedTrigger],
      ['trigger.email_opened', emailOpenedTrigger],
    ] as const) {
      expect(defaultRegistry.require(type)).toBe(node);
    }
  });
});
