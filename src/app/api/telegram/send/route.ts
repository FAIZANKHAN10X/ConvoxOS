import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendTelegramText, SendTelegramError } from '@/lib/channels/telegram/send'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send-telegram:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id: conversationIdInput,
      contact_id,
      content_text,
      reply_to_message_id,
    } = body

    if ((!conversationIdInput && !contact_id) || !content_text) {
      return NextResponse.json(
        { error: 'Either conversation_id or contact_id, plus content_text, are required' },
        { status: 400 }
      )
    }

    // Validate text shape before find-or-create to avoid orphan conversation
    if (typeof content_text !== 'string' || !content_text.trim()) {
      return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
    }
    if (content_text.length > 4096) {
      return NextResponse.json({ error: 'Text exceeds 4096 character limit' }, { status: 400 })
    }

    let conversationId: string | null = null

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (convError || !data) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
      conversationId = data.id
    } else {
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      }

      const resolved = await findOrCreateConversation(supabase, accountId, userId, contact_id)
      if (!resolved) {
        return NextResponse.json({ error: 'Failed to open a conversation for this contact' }, { status: 500 })
      }
      conversationId = resolved
    }

    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    try {
      const result = await sendTelegramText(supabase, accountId, {
        conversationId,
        contentText: content_text,
        replyToMessageId: reply_to_message_id || null,
      })

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        telegram_message_id: result.telegramMessageId,
      })
    } catch (err) {
      if (err instanceof SendTelegramError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error('Error in Telegram send POST:', error)
    return toErrorResponse(error)
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>

async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  userId: string,
  contactId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}
