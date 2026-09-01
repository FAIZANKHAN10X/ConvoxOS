import { createClient } from '@/lib/supabase/server'
import { AutomationsClient } from './automations-client'

export const dynamic = 'force-dynamic'

// Server-first hybrid: initial automations + flows render from RSC.
// Mutations and template loading remain in the client island so
// existing UX (filters, duplicate, delete) is preserved.
export default async function AutomationsPage() {
  const supabase = await createClient()
  const [{ data: automationsData }, { data: flowsData }] = await Promise.all([
    supabase.from('automations').select('*').order('created_at', { ascending: false }),
    supabase.from('flows').select('*').order('created_at', { ascending: false }),
  ])

  return (
    <AutomationsClient
      initialAutomations={(automationsData ?? []) as never}
      initialFlows={(flowsData ?? []) as never}
      initialTemplates={[]}
    />
  )
}
