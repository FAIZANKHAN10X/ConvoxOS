import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT } from '../event-types';
import { defaultRegistry } from '../registry';
import type { DomainEvent } from '../types';
import { formSubmittedTrigger } from './form-submitted';
import './index';

const FORM_ID = '11111111-1111-1111-1111-111111111111';

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.FORM_SUBMITTED,
    contactId: 'contact-1',
    payload: { form_id: FORM_ID, submission_id: 'sub-1' },
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
    ...overrides,
  };
}

describe('trigger.form_submitted', () => {
  it('matches with optional form filter', () => {
    expect(formSubmittedTrigger.match?.(event(), {})).toBe(true);
    expect(formSubmittedTrigger.match?.(event(), { formId: FORM_ID })).toBe(true);
    expect(
      formSubmittedTrigger.match?.(event(), {
        formId: '99999999-9999-9999-9999-999999999999',
      })
    ).toBe(false);
    expect(
      formSubmittedTrigger.match?.(
        event({ eventType: DOMAIN_EVENT.CONTACT_CREATED }),
        {}
      )
    ).toBe(false);
  });

  it('is registered in the default registry', () => {
    expect(defaultRegistry.require('trigger.form_submitted')).toBe(
      formSubmittedTrigger
    );
  });
});
