// Server-side account member lookup (profiles.id ↔ auth.users).
// Client UI member lists live in lib/account/members.ts — different
// boundary (fetch + email visibility), not a duplicate of this file.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AccountMember {
  id: string;
  userId: string | null;
  fullName: string | null;
}

/**
 * Resolve an account member by profiles.id, scoped to the account.
 * Deals reference `profiles.id` while conversations/tasks reference
 * `auth.users` ids — this is the single mapping point between them.
 */
export async function getAccountMember(
  db: SupabaseClient,
  accountId: string,
  profileId: string
): Promise<AccountMember | null> {
  const { data, error } = await db
    .from('profiles')
    .select('id, user_id, full_name')
    .eq('id', profileId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; user_id: string | null; full_name: string | null };
  return { id: row.id, userId: row.user_id, fullName: row.full_name };
}
