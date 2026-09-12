import type { SupabaseClient } from '@supabase/supabase-js';

import { DOMAIN_EVENT } from './event-types';
import { enqueueDomainEventWithClient } from './events';
import { kickDomainEvent } from './kick';

interface EmitArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  source?: 'crm' | 'automation';
  originRunId?: string | null;
  causationEventId?: string | null;
  chainDepth?: number;
}

async function emit(
  db: SupabaseClient,
  eventType: string,
  args: EmitArgs
): Promise<void> {
  const event = await enqueueDomainEventWithClient(db, {
    accountId: args.accountId,
    eventType,
    contactId: args.contactId,
    payload: args.payload ?? {},
    source: args.source ?? 'crm',
    originRunId: args.originRunId ?? null,
    causationEventId: args.causationEventId ?? null,
    chainDepth: args.chainDepth ?? 0,
    idempotencyKey: args.idempotencyKey,
  });
  kickDomainEvent(event.id);
}

export async function emitContactCreated(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.CONTACT_CREATED, args);
}

export async function emitContactUpdated(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.CONTACT_UPDATED, args);
}

export async function emitMessageReceived(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.MESSAGE_RECEIVED, args);
}

export async function emitTaskCreated(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.TASK_CREATED, args);
}

export async function emitTaskCompleted(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.TASK_COMPLETED, args);
}

export async function emitTaskOverdue(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.TASK_OVERDUE, args);
}

export async function emitNoteAdded(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.NOTE_ADDED, args);
}

export interface EmitDealArgs extends EmitArgs {
  dealId: string;
}

export async function emitDealCreated(args: EmitDealArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.DEAL_CREATED, args);
}

export async function emitDealUpdated(args: EmitDealArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.DEAL_UPDATED, args);
}

export async function emitDealStageChanged(
  args: EmitDealArgs
): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.DEAL_STAGE_CHANGED, args);
}

export interface EmitDealStatusChangedArgs extends EmitArgs {
  dealId: string;
}

/**
 * T4.5: fired when a deal moves between open/won/lost (UI status
 * buttons or future automation paths). Trigger consumption
 * belongs to T5 — this only records the domain fact.
 */
export async function emitDealStatusChanged(
  args: EmitDealStatusChangedArgs
): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.DEAL_STATUS_CHANGED, args);
}
