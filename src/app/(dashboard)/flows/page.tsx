import { createClient } from '@/lib/supabase/server'
import { FlowsClient } from './flows-client'

export const dynamic = 'force-dynamic'

// Server-first hybrid: initial flows list renders from RSC.
// Template metadata still loads client-side where needed.
export default async function FlowsPage() {
  const supabase = await createClient()
  const { data: flowsData } = await supabase.from('flows').select('*').order('created_at', { ascending: false })

  return <FlowsClient initialFlows={(flowsData ?? []) as never} initialTemplates={[]} />
}
