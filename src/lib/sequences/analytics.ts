import type { SupabaseClient } from '@supabase/supabase-js';

export interface SequenceAnalytics {
  enrolled: number;
  active: number;
  paused: number;
  completed: number;
  stopped: number;
  failed: number;
  sent: number;
  replied: number;
}

/**
 * T4.4 analytics v1: one RPC call (migration 074) returning the
 * whole summary row. Runs with the caller's user client — the RPC
 * is SECURITY INVOKER with explicit account predicates, so RLS
 * still applies on top. Returns zeros when the sequence has no
 * enrollments or doesn't belong to the account.
 */
export async function loadSequenceAnalytics(
  db: SupabaseClient,
  accountId: string,
  sequenceId: string
): Promise<SequenceAnalytics> {
  const { data, error } = await db.rpc('get_sequence_analytics', {
    p_account_id: accountId,
    p_sequence_id: sequenceId,
  });
  if (error) throw new Error(`sequence analytics: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Partial<
    Record<keyof SequenceAnalytics, number | string | null>
  > | null;
  const num = (v: number | string | null | undefined): number => Number(v ?? 0);
  return {
    enrolled: num(row?.enrolled),
    active: num(row?.active),
    paused: num(row?.paused),
    completed: num(row?.completed),
    stopped: num(row?.stopped),
    failed: num(row?.failed),
    sent: num(row?.sent),
    replied: num(row?.replied),
  };
}
