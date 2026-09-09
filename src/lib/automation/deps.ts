import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';

import type { EngineDeps } from './engine';
import { createPostgresStore } from './postgres-store';
import { defaultRegistry } from './registry';

export function createEngineDeps(db?: SupabaseClient): EngineDeps {
  const client = db ?? supabaseAdmin();
  return {
    store: createPostgresStore(client),
    registry: defaultRegistry,
    db: client,
  };
}
