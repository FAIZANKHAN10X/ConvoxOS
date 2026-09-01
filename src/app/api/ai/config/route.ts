import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, status, identity, behaviour, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    // Load existing for partial updates (e.g. status-only or identity-only)
    const { data: existingEarly } = await supabase.from('ai_configs').select('id, provider, model, api_key').eq('account_id', accountId).maybeSingle()
    const hasProvider = 'provider' in body
    const hasModel = 'model' in body
    let provider: AiProvider | null = null
    let model: string | null = null
    if (hasProvider) {
      const p = body.provider as AiProvider
      if (p !== 'openai' && p !== 'anthropic') return bad('provider must be "openai" or "anthropic"')
      provider = p
    } else if (existingEarly) {
      provider = existingEarly.provider as AiProvider
    }
    if (hasModel) {
      const m = typeof body.model === 'string' ? body.model.trim() : ''
      if (!m) return bad('model is required')
      model = m
    } else if (existingEarly) {
      model = existingEarly.model
    }
    // For create (no existing), provider/model are required
    if (!existingEarly && (!provider || !model)) return bad('provider and model are required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    // New canonical lifecycle — prefer `status` over legacy booleans
    const rawStatus = typeof body.status === 'string' ? body.status.trim() : ''
    const validStatuses = new Set(['draft', 'paused', 'live'])
    let status: string | null = null
    let isActive: boolean
    let autoReplyEnabled: boolean
    if (rawStatus) {
      if (!validStatuses.has(rawStatus)) return bad('status must be draft, paused or live')
      status = rawStatus
      isActive = status !== 'draft'
      autoReplyEnabled = status === 'live'
    } else {
      isActive = body.is_active === true
      autoReplyEnabled = body.auto_reply_enabled === true
      if (isActive && autoReplyEnabled) status = 'live'
      else if (isActive) status = 'paused'
      else status = 'draft'
    }

    // Identity: { name, role, description } — all optional strings
    let identity: Record<string, unknown> | null = null
    if ('identity' in body && body.identity != null) {
      if (typeof body.identity !== 'object' || Array.isArray(body.identity)) return bad('identity must be an object')
      const raw = body.identity as Record<string, unknown>
      identity = {}
      if ('name' in raw) {
        if (typeof raw.name !== 'string') return bad('identity.name must be a string')
        const n = raw.name.trim()
        if (n.length > 80) return bad('identity.name too long (max 80)')
        if (n) identity.name = n
      }
      if ('role' in raw) {
        const r = typeof raw.role === 'string' ? raw.role.trim() : ''
        if (r && !['support', 'sales', 'concierge'].includes(r)) return bad('identity.role must be support, sales or concierge')
        if (r) identity.role = r
      }
      if ('description' in raw) {
        if (typeof raw.description !== 'string') return bad('identity.description must be a string')
        const d = raw.description.trim()
        if (d.length > 500) return bad('identity.description too long (max 500)')
        if (d) identity.description = d
      }
    }

    // Behaviour: { tone, responseLength, instructions }
    let behaviour: Record<string, unknown> | null = null
    let instructionsFromBehaviour: string | null = null
    if ('behaviour' in body && body.behaviour != null) {
      if (typeof body.behaviour !== 'object' || Array.isArray(body.behaviour)) return bad('behaviour must be an object')
      const raw = body.behaviour as Record<string, unknown>
      behaviour = {}
      if ('tone' in raw) {
        const t = typeof raw.tone === 'string' ? raw.tone.trim() : ''
        if (t && !['friendly', 'professional', 'concise'].includes(t)) return bad('behaviour.tone must be friendly, professional or concise')
        if (t) behaviour.tone = t
      }
      if ('responseLength' in raw) {
        const rl = typeof raw.responseLength === 'string' ? raw.responseLength.trim() : ''
        if (rl && !['short', 'medium', 'long'].includes(rl)) return bad('behaviour.responseLength must be short, medium or long')
        if (rl) behaviour.responseLength = rl
      }
      if ('instructions' in raw) {
        if (typeof raw.instructions !== 'string') return bad('behaviour.instructions must be a string')
        const ins = raw.instructions.trim()
        if (ins.length > 8000) return bad('behaviour.instructions too long (max 8000)')
        if (ins) {
          behaviour.instructions = ins
          instructionsFromBehaviour = ins
        }
      }
      // Persist even if empty object to clear?
      if (Object.keys(behaviour).length === 0) behaviour = {}
    }

    // If behaviour.instructions was supplied, keep system_prompt in sync for runtime compat
    const effectiveSystemPrompt = instructionsFromBehaviour ?? systemPrompt

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const existing = existingEarly

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider: provider as import('@/lib/ai/types').AiProvider,
          model: model as string,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          status: status as import('@/lib/ai/types').AiStatus,
          identity: {},
          behaviour: {},
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: effectiveSystemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      status,
      auto_reply_max_per_conversation: maxPer,
    }
    if (identity !== null) shared.identity = identity
    if (behaviour !== null) shared.behaviour = behaviour
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
