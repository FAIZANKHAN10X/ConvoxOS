import type { SupabaseClient } from '@supabase/supabase-js';

import type { AutomationStore } from './store';
import type { DomainEvent, NewDomainEvent } from './types';

export async function enqueueDomainEvent(
  store: AutomationStore,
  input: NewDomainEvent
): Promise<DomainEvent> {
  return store.insertEvent(input);
}

/**
 * Enqueue through a live Supabase client (member-scoped CRM writes).
 * The unique (account_id, idempotency_key) constraint makes retries
 * of the same occurrence a no-op.
 */
export async function enqueueDomainEventWithClient(
  db: SupabaseClient,
  input: NewDomainEvent
): Promise<DomainEvent> {
  const { data, error } = await db
    .from('domain_events')
    .insert({
      account_id: input.accountId,
      event_type: input.eventType,
      contact_id: input.contactId ?? null,
      payload: input.payload ?? {},
      source: input.source ?? 'crm',
      origin_run_id: input.originRunId ?? null,
      causation_event_id: input.causationEventId ?? null,
      chain_depth: input.chainDepth ?? 0,
      idempotency_key: input.idempotencyKey,
      available_at: input.availableAt ?? new Date().toISOString(),
    })
    .select('*')
    .maybeSingle();

  if (error?.code === '23505') {
    const { data: existing, error: readError } = await db
      .from('domain_events')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (readError || !existing) {
      throw new Error(
        `domain event conflict without existing row: ${error.message}`
      );
    }
    return mapEventRow(existing);
  }

  if (error || !data) {
    throw new Error(
      `failed to enqueue domain event: ${error?.message ?? 'no row'}`
    );
  }

  return mapEventRow(data);
}

export function mapEventRow(row: Record<string, unknown>): DomainEvent {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    eventType: row.event_type as string,
    contactId: (row.contact_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    source: (row.source as DomainEvent['source']) ?? 'crm',
    originRunId: (row.origin_run_id as string | null) ?? null,
    causationEventId: (row.causation_event_id as string | null) ?? null,
    chainDepth: (row.chain_depth as number) ?? 0,
    idempotencyKey: row.idempotency_key as string,
    status: row.status as DomainEvent['status'],
    attempts: (row.attempts as number) ?? 0,
    availableAt: row.available_at as string,
    processedAt: (row.processed_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}
