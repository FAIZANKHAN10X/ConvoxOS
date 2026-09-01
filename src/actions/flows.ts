'use server'

import { revalidatePath } from 'next/cache'
import { updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Server Action alternative to `fetch("/api/flows")` / `fetch("/api/automations")`
 * thin CRUD wrappers (Phase C).
 *
 * These are internal-only — external consumers (webhooks, cron, v1 API)
 * must keep using `/api/*` HTTP routes. Browser callers inside the
 * dashboard should gradually move to these actions so we eliminate the
 * extra `browser → Next → Supabase → JSON → setState` hop.
 *
 * Each mutation invalidates the corresponding `revalidateTag` so RSC
 * pages (`dashboard`, `flows`, `automations`) can use `unstable_cache`
 * or `fetch(…{ next:{tags:['flows']}})` and get on-demand freshness
 * without a full reload.
 */

export async function getFlowsAction() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flows')
    .select('id, name, status, trigger_type, entry_node_id, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createFlowAction(input: {
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Resolve account — same logic as api/flows/route.ts POST
  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
  const accountId = (profile as { account_id: string } | null)?.account_id
  if (!accountId) throw new Error('No account')

  const { data, error } = await supabase
    .from('flows')
    .insert({
      account_id: accountId,
      name: input.name,
      trigger_type: input.trigger_type,
      trigger_config: input.trigger_config,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  updateTag('flows')
  revalidatePath('/flows')
  revalidatePath('/automations')
  return data
}

export async function deleteFlowAction(flowId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('flows').delete().eq('id', flowId)
  if (error) throw new Error(error.message)
  updateTag('flows')
  revalidatePath('/flows')
}
