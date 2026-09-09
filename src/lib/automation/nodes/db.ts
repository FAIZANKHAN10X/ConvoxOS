import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExecutionContext } from '../types';

export function asDb(ctx: ExecutionContext): SupabaseClient {
  return ctx.db as SupabaseClient;
}
