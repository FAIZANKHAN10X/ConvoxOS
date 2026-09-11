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
 *
 * Idempotency keys are deterministic per (contact, tag, causation):
 * a retried write after a crash dedupes on the UNIQUE
 * (account_id, idempotency_key) constraint instead of spawning a
 * second run. A genuine re-add (remove then add again) collides with
 * a terminal event, so it falls back to a suffixed key — the state
 * change is real and deserves its own event.
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
  const causation =
    input.context?.causationEventId ??
    input.context?.originRunId ??
    'crm';
  const event = await enqueueTagEvent(input.db, {
    accountId: input.accountId,
    eventType: DOMAIN_EVENT.TAG_ADDED,
    contactId: input.contactId,
    tagId: input.tagId,
    source: input.context?.source ?? 'crm',
    originRunId: input.context?.originRunId ?? null,
    causationEventId: input.context?.causationEventId ?? null,
    chainDepth: depth,
    baseKey: `tag_added:${input.contactId}:${input.tagId}:${causation}`,
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
  const causation =
    input.context?.causationEventId ??
    input.context?.originRunId ??
    'crm';
  const event = await enqueueTagEvent(input.db, {
    accountId: input.accountId,
    eventType: DOMAIN_EVENT.TAG_REMOVED,
    contactId: input.contactId,
    tagId: input.tagId,
    source: input.context?.source ?? 'crm',
    originRunId: input.context?.originRunId ?? null,
    causationEventId: input.context?.causationEventId ?? null,
    chainDepth: depth,
    baseKey: `tag_removed:${input.contactId}:${input.tagId}:${causation}`,
  });

  kickDomainEvent(event.id);

  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    return { removed: true, dispatched: false, reason: 'max_depth' };
  }

  return { removed: true, dispatched: true };
}

interface TagEventEnqueue {
  accountId: string;
  eventType: string;
  contactId: string;
  tagId: string;
  source: 'crm' | 'automation';
  originRunId: string | null;
  causationEventId: string | null;
  chainDepth: number;
  baseKey: string;
}

/**
 * Deterministic enqueue with genuine-cycle fallback. A retried write
 * lands on the same key and dedupes; a real remove→add cycle finds a
 * terminal event under the base key and mints a suffixed successor so
 * the new state change still triggers automations.
 */
async function enqueueTagEvent(
  db: SupabaseClient,
  args: TagEventEnqueue
) {
  const event = await enqueueDomainEventWithClient(db, {
    accountId: args.accountId,
    eventType: args.eventType,
    contactId: args.contactId,
    payload: { tag_id: args.tagId },
    source: args.source,
    originRunId: args.originRunId,
    causationEventId: args.causationEventId,
    chainDepth: args.chainDepth,
    idempotencyKey: args.baseKey,
  });
  const terminal =
    event.status === 'processed' ||
    event.status === 'skipped' ||
    event.status === 'failed';
  if (!terminal) return event;
  // Base key collided with a terminal event: genuine new occurrence.
  return enqueueDomainEventWithClient(db, {
    accountId: args.accountId,
    eventType: args.eventType,
    contactId: args.contactId,
    payload: { tag_id: args.tagId },
    source: args.source,
    originRunId: args.originRunId,
    causationEventId: args.causationEventId,
    chainDepth: args.chainDepth,
    idempotencyKey: `${args.baseKey}:${crypto.randomUUID()}`,
  });
}
