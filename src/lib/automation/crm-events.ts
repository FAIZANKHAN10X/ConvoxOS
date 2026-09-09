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
    source: 'crm',
    idempotencyKey: args.idempotencyKey,
  });
  kickDomainEvent(event.id);
}

export async function emitContactCreated(args: EmitArgs): Promise<void> {
  await emit(args.db, DOMAIN_EVENT.CONTACT_CREATED, args);
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
