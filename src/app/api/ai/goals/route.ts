import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const VALID_KINDS = new Set(['capture_lead', 'share_link', 'custom'])
const VALID_PRIORITIES = (p: number) => Number.isInteger(p) && p >= 0 && p <= 100

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data: config } = await supabase.from('ai_configs').select('id').eq('account_id', accountId).maybeSingle()
    if (!config) return NextResponse.json({ goals: [] })
    const { data, error } = await supabase
      .from('ai_goals')
      .select('*')
      .eq('account_id', accountId)
      .eq('ai_config_id', config.id)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    return NextResponse.json({ goals: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-goals:${accountId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid body')

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('name is required')
    if (name.length > 80) return bad('name too long (max 80)')

    const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
    if (!VALID_KINDS.has(kind)) return bad('kind must be capture_lead, share_link or custom')

    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : null
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}

    // kind-specific validation
    if (kind === 'capture_lead') {
      const fields = (params as Record<string, unknown>).fields
      if (fields !== undefined) {
        if (!Array.isArray(fields) || fields.some((f) => typeof f !== 'string' || !['email', 'phone', 'name'].includes(f))) {
          return bad('capture_lead fields must be array of email, phone, name')
        }
      }
    }
    if (kind === 'share_link') {
      const url = (params as Record<string, unknown>).url
      if (url !== undefined && url !== null && url !== '') {
        if (typeof url !== 'string') return bad('share_link url must be a string')
        try {
          const u = new URL(url)
          if (!['http:', 'https:'].includes(u.protocol)) return bad('share_link url must be http or https')
        } catch {
          return bad('share_link url must be a valid URL')
        }
      }
    }

    let priority = typeof body.priority === 'number' ? Math.floor(body.priority) : 0
    if (!VALID_PRIORITIES(priority)) priority = 0

    const enabled = body.enabled === undefined ? true : Boolean(body.enabled)

    const { data: config } = await supabase.from('ai_configs').select('id').eq('account_id', accountId).maybeSingle()
    if (!config) return bad('AI config not found — configure the agent first')

    // Next priority if not specified: max+1
    if (body.priority === undefined) {
      const { data: maxRow } = await supabase.from('ai_goals').select('priority').eq('account_id', accountId).order('priority', { ascending: false }).limit(1).maybeSingle()
      priority = ((maxRow as { priority: number } | null)?.priority ?? -1) + 1
    }

    const { data, error } = await supabase
      .from('ai_goals')
      .insert({
        ai_config_id: config.id,
        account_id: accountId,
        name,
        kind,
        description: description || null,
        params,
        priority,
        enabled,
      })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ goal: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
