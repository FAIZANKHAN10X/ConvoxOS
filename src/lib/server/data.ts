/**
 * Small focused server-side data helpers.
 *
 *  - No over-engineered repository framework.
 *  - Each helper has ONE Supabase query, narrow projection, and a
 *    stable return type.
 *  - Used by Server Components (dashboard RSC) and Server Actions
 *    (internal CRUD) to replace `fetch("/api/...")` hops.
 *  - Caching is caller-owned — helpers don't set `s-maxage`; they
 *    return plain data and the caller decides `unstable_cache` /
 *    `revalidateTag` semantics.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Narrow tag projection — avoids `select("*")` which pulls unused
// `created_at` etc. when the builder only needs id/name/color.
export async function getTags(db: SupabaseClient) {
  const { data, error } = await db
    .from('tags')
    .select('id, name, color')
    .order('name')
  if (error) throw error
  return data ?? []
}

// NOTE: getFlows / getAutomations were retired with the old automation
// engine (Phase 9). They will return as Automations v2 — no stubs kept.

// Paginated contacts helper — replaces the N+1 `contacts → contact_tags IN (ids)`
// waterfall in `contacts/page.tsx:107-210`. Single join via PostgREST
// `contacts(*) + contact_tags(tag:tags)` embed.
export async function getContactsPage(
  db: SupabaseClient,
  opts: { from: number; to: number; search?: string },
) {
  let query = db
    .from('contacts')
    .select('id, name, phone, avatar_url, created_at, contact_tags(tag:tags(id, name, color))', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(opts.from, opts.to)

  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`
    query = query.or(`name.ilike.${s},phone.ilike.${s}`)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
