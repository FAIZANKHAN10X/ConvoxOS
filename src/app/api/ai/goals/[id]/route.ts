import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const VALID_KINDS = new Set(['capture_lead', 'share_link', 'custom'])

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const limit = checkRateLimit(`ai-goals:${accountId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid body')

    const patch: Record<string, unknown> = {}

    if ('name' in body) {
      const n = typeof body.name === 'string' ? body.name.trim() : ''
      if (!n) return bad('name is required')
      if (n.length > 80) return bad('name too long')
      patch.name = n
    }
    if ('kind' in body) {
      const k = typeof body.kind === 'string' ? body.kind.trim() : ''
      if (!VALID_KINDS.has(k)) return bad('kind must be capture_lead, share_link or custom')
      patch.kind = k as string
    }
    if ('description' in body) {
      const d = typeof body.description === 'string' ? body.description.trim() : ''
      patch.description = d ? d.slice(0, 500) : null
    }
    if ('params' in body) {
      const p = body.params
      if (p !== null && (typeof p !== 'object' || Array.isArray(p))) return bad('params must be an object')
      // Re-validate kind-specific
      const kind = (patch.kind as string) ?? null
      // Fetch existing to know kind if not patched
      let effectiveKind: string | null = kind
      if (!effectiveKind) {
        const { data: existing } = await supabase.from('ai_goals').select('kind').eq('id', id).eq('account_id', accountId).maybeSingle()
        effectiveKind = (existing as { kind: string } | null)?.kind ?? null
      }
      if (effectiveKind === 'capture_lead' && p) {
        const fields = (p as Record<string, unknown>).fields
        if (fields !== undefined && (!Array.isArray(fields) || fields.some((f: unknown) => typeof f !== 'string' || !['email', 'phone', 'name'].includes(f as string)))) {
          return bad('capture_lead fields must be array of email, phone, name')
        }
      }
      if (effectiveKind === 'share_link' && p) {
        const url = (p as Record<string, unknown>).url
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
      patch.params = p ?? {}
    }
    if ('priority' in body) {
      const pr = Number(body.priority)
      if (!Number.isInteger(pr) || pr < 0 || pr > 100) return bad('priority must be 0-100 integer')
      patch.priority = pr
    }
    if ('enabled' in body) patch.enabled = Boolean(body.enabled)

    if (Object.keys(patch).length === 0) return bad('No fields to update')

    const { data, error } = await supabase.from('ai_goals').update(patch).eq('id', id).eq('account_id', accountId).select('*').single()
    if (error) throw error
    return NextResponse.json({ goal: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('ai_goals').delete().eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data, error } = await supabase.from('ai_goals').select('*').eq('id', id).eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ goal: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
