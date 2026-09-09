import type { SupabaseClient } from '@supabase/supabase-js';

import { DOMAIN_EVENT } from '@/lib/automation/event-types';
import { enqueueDomainEventWithClient } from '@/lib/automation/events';
import { kickDomainEvent } from '@/lib/automation/kick';

import { addContactTagIfAbsent, removeContactTag } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface TagDispatchInput {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: {
    vars?: Record<string, unknown>;
    source?: 'crm' | 'automation';
    originRunId?: string;
    causationEventId?: string;
  };
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

export interface RemoveContactTagResult {
  removed: boolean;
  dispatched: boolean;
  reason?: 'absent' | 'max_depth';
}

/**
 * Central server-side tag writer. Records the join for a newly-added
 * tag and enqueues a `tag_added` domain event for the automation
 * worker. Chain depth is the loop guard: events at MAX_TAG_CHAIN_DEPTH
 * are stored but not matched.
 */
export async function addContactTagAndDispatch(
  input: TagDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  const depth = getTagChainDepth(input.context);
  const event = await enqueueDomainEventWithClient(input.db, {
    accountId: input.accountId,
    eventType: DOMAIN_EVENT.TAG_ADDED,
    contactId: input.contactId,
    payload: { tag_id: input.tagId },
    source: input.context?.source ?? 'crm',
    originRunId: input.context?.originRunId ?? null,
    causationEventId: input.context?.causationEventId ?? null,
    chainDepth: depth,
    idempotencyKey: `tag_added:${input.contactId}:${input.tagId}:${crypto.randomUUID()}`,
  });

  kickDomainEvent(event.id);

  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    return { added: true, dispatched: false, reason: 'max_depth' };
  }

  return { added: true, dispatched: true };
}

export async function removeContactTagAndDispatch(
  input: TagDispatchInput
): Promise<RemoveContactTagResult> {
  const removed = await removeContactTag(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!removed) {
    return { removed: false, dispatched: false, reason: 'absent' };
  }

  const depth = getTagChainDepth(input.context);
  const event = await enqueueDomainEventWithClient(input.db, {
    accountId: input.accountId,
    eventType: DOMAIN_EVENT.TAG_REMOVED,
    contactId: input.contactId,
    payload: { tag_id: input.tagId },
    source: input.context?.source ?? 'crm',
    originRunId: input.context?.originRunId ?? null,
    causationEventId: input.context?.causationEventId ?? null,
    chainDepth: depth,
    idempotencyKey: `tag_removed:${input.contactId}:${input.tagId}:${crypto.randomUUID()}`,
  });

  kickDomainEvent(event.id);

  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    return { removed: true, dispatched: false, reason: 'max_depth' };
  }

  return { removed: true, dispatched: true };
}
