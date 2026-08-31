import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data: automation } = await admin.from('automations').select('id, account_id').eq('id', id).maybeSingle()
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const since = new Date(Date.now() - 30 * 24 * 3600000).toISOString()

  // Attempted/matched/unmatched from trigger evaluations (truthful, 30d)
  const { data: evals } = await admin
    .from('automation_trigger_evaluations')
    .select('matched')
    .eq('automation_id', id)
    .gte('created_at', since)
  const evalsArr = (evals ?? []) as Array<{ matched: boolean }>
  const attempted = evalsArr.length
  const matched = evalsArr.filter((e) => e.matched).length
  const unmatched = evalsArr.filter((e) => !e.matched).length

  const { data: logs } = await admin
    .from('automation_logs')
    .select('status, trigger_event, created_at')
    .eq('automation_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000)

  const logsArr = (logs ?? []) as Array<{ status: string; trigger_event: string }>
  const completed = logsArr.filter((l) => l.status === 'success').length
  const failed = logsArr.filter((l) => l.status === 'failed').length
  const cancelled = logsArr.filter((l) => l.status === 'partial').length // partial is used for waiting/cancelled in current model
  const executed = matched // matched executions that started (should equal logs count, but use matched for truth)

  return NextResponse.json({
    window: '30d',
    since,
    attempted,
    matched,
    unmatched,
    executed: matched,
    completed,
    failed,
    cancelled,
    total: attempted,
  })
}
