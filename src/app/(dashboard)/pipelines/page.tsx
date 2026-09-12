import { createClient } from '@/lib/supabase/server'
import PipelinesClient from './pipelines-client'
import type { Pipeline } from '@/types'

// Server-first hybrid (contacts-page pattern): the pipelines list
// loads via RSC so the shell renders with data on first paint.
// Selection, stages/deals, dialogs, and drag/drop stay in the
// client island. Empty initial state preserves the seed-if-empty
// flow inside the client.
export default async function PipelinesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('pipelines')
    .select('*')
    .order('created_at')
  return <PipelinesClient initialPipelines={(data ?? []) as Pipeline[]} />
}
