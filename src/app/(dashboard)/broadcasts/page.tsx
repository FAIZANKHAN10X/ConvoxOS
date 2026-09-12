import { createClient } from '@/lib/supabase/server'
import BroadcastsClient from './broadcasts-client'
import type { Broadcast } from '@/types'

export const dynamic = 'force-dynamic'

// Server-first hybrid: initial list loads via RSC so the table
// renders on first paint. Polling-while-sending, navigation, and
// refresh stay in the client island.
export default async function BroadcastsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
  return <BroadcastsClient initialBroadcasts={(data ?? []) as Broadcast[]} />
}
