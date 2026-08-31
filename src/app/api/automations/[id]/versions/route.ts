import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('automation_versions')
    .select('id, version_number, is_published, created_at, created_by')
    .eq('automation_id', id)
    .order('version_number', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data ?? [] })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { version_number?: number } | null
  if (!body?.version_number) return NextResponse.json({ error: 'version_number required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: version } = await admin
    .from('automation_versions')
    .select('snapshot')
    .eq('automation_id', id)
    .eq('version_number', body.version_number)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const snap = (version as { snapshot: { trigger_type: string; trigger_config: unknown; steps: unknown } }).snapshot

  // Restore into draft (is_active false) — do not auto-publish
  const { error: updErr } = await admin
    .from('automations')
    .update({
      trigger_type: snap.trigger_type,
      trigger_config: snap.trigger_config,
      is_active: false,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Replace steps
  const { replaceSteps } = await import('@/lib/automations/steps-tree')
  const err = await replaceSteps(id, snap.steps as never)
  if (err) return NextResponse.json({ error: err }, { status: 500 })

  return NextResponse.json({ ok: true })
}
