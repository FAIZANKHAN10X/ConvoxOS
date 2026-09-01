import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge, retrieveKnowledgeWithSources } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { createAgentTools } from '@/lib/ai/tools'
import { runAgent } from '@/lib/ai/agent'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    // Try agent with tools (knowledge + handoff) for playground, fallback to simple generate
    let text: string
    let handoff = false
    let toolCalls: unknown[] = []
    let sources: Array<{ title: string; type: string }> = []
    try {
      const withSources = await retrieveKnowledgeWithSources(supabase, accountId, config, latestUserMessage(messages), 3)
      const knowledge = withSources.map((s) => s.content)
      sources = withSources.map((s) => ({ title: s.sourceTitle ?? 'Knowledge', type: s.sourceType ?? 'text' }))
      const systemPrompt = buildSystemPrompt({
        userPrompt: config.behaviour?.instructions ?? config.systemPrompt,
        mode: 'auto_reply',
        knowledge,
      })
      const registry = createAgentTools()
      // Playground has no real contact/conversation — provide minimal context
      const run = await runAgent({
        config,
        systemPrompt,
        messages,
        registry,
        context: { accountId, supabase },
      })
      text = run.text
      handoff = run.handoff
      toolCalls = run.toolCalls
    } catch {
      const knowledge = await retrieveKnowledge(supabase, accountId, config, latestUserMessage(messages))
      const systemPrompt = buildSystemPrompt({
        userPrompt: config.behaviour?.instructions ?? config.systemPrompt,
        mode: 'auto_reply',
        knowledge,
      })
      const r = await generateReply({ config, systemPrompt, messages })
      text = r.text
      handoff = r.handoff
    }
    return NextResponse.json({ reply: text, handoff, toolCalls, sources })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
