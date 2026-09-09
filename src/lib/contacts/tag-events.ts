import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagIfAbsent } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface AddContactTagAndDispatchInput {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: Record<string, unknown>;
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

/**
 * Central server-side tag writer. Records the join for a newly-added
 * tag and caps chained depth to avoid loops. (The old tag_added
 * automation dispatch was retired with the automation engine; v2
 * domain events will reintroduce it.)
 */
export async function addContactTagAndDispatch(
  input: AddContactTagAndDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  return { added: true, dispatched: false };
}
