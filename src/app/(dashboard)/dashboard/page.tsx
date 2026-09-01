import { createClient } from '@/lib/supabase/server'
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import { DashboardClient } from './dashboard-client'

export const dynamic = 'force-dynamic'

// Server-first hybrid: data loads via RSC (single Supabase hop,
// streamed HTML, no client waterfall). Interactive islands (range
// toggle, derived UI) live in DashboardClient.
export default async function DashboardPage() {
  const supabase = await createClient()

  const [metrics, series30, pipeline, responseTime, activity] = await Promise.all([
    loadMetrics(supabase).catch((err) => {
      console.error('[dashboard] metrics failed:', err)
      return null
    }),
    loadConversationsSeries(supabase, 30).catch((err) => {
      console.error('[dashboard] series failed:', err)
      return null
    }),
    loadPipelineDonut(supabase).catch((err) => {
      console.error('[dashboard] pipeline failed:', err)
      return null
    }),
    loadResponseTime(supabase).catch((err) => {
      console.error('[dashboard] response time failed:', err)
      return null
    }),
    loadActivity(supabase, 50).catch((err) => {
      console.error('[dashboard] activity failed:', err)
      return null
    }),
  ])

  return (
    <DashboardClient
      initialMetrics={metrics}
      initialSeries30={series30}
      initialPipeline={pipeline}
      initialResponseTime={responseTime}
      initialActivity={activity}
    />
  )
}
