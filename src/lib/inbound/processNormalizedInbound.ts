import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { Channel, NormalizedInbound } from '@/lib/channels/types'

let _adminClient: SupabaseClient | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// ----- helpers copied from whatsapp webhook for shared use -----

async function lookupInternalIdByMetaId(metaId: string, conversationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[inbound] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !recs || recs.length === 0) return
    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updErr) console.error('Error marking broadcast recipient replied:', updErr)
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

async function handleReactionShared(
  conversationId: string,
  contactId: string,
  targetProviderId: string,
  emoji: string | null
) {
  const targetInternalId = await lookupInternalIdByMetaId(targetProviderId, conversationId)
  if (!targetInternalId) {
    console.warn('[inbound] reaction target not found; skipping', targetProviderId)
    return
  }
  if (!emoji) {
    const { error } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (error) console.error('[inbound] reaction delete failed:', error.message)
    return
  }
  const { error } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (error) console.error('[inbound] reaction upsert failed:', error.message)
}

// channel-aware contact dedupe: WA via phone, TG via telegram_user_id
type NormalizedInboundInput = NormalizedInbound & {
  contentType?: string
  contentText?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
  replyToProviderId?: string | null
  targetProviderId?: string | null
}

async function findOrCreateContactUnified(n: NormalizedInboundInput) {
  const { accountId, configOwnerUserId, channel } = n
  // Telegram path
  if (channel === 'telegram') {
    const telegramUserId = n.telegramUserId
    const telegramChatId = n.telegramChatId
    const telegramUsername = n.telegramUsername
    const senderName = n.senderName
    if (telegramUserId == null) return null
    // lookup by telegram_user_id
    const { data: existing } = await supabaseAdmin()
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle()
    if (existing) {
      // update chat_id/username if changed, name if provided
      const updates: Record<string, unknown> = {}
      if (telegramChatId != null && existing.telegram_chat_id !== telegramChatId) updates.telegram_chat_id = telegramChatId
      if (telegramUsername !== existing.telegram_username) updates.telegram_username = telegramUsername
      if (senderName && senderName !== existing.name) updates.name = senderName
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString()
        await supabaseAdmin().from('contacts').update(updates).eq('id', existing.id)
      }
      return { contact: existing, wasCreated: false }
    }
    const { data: newContact, error } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        phone: null,
        name: senderName || telegramUsername || `Telegram ${telegramUserId}`,
        telegram_user_id: telegramUserId,
        telegram_chat_id: telegramChatId ?? null,
        telegram_username: telegramUsername ?? null,
      })
      .select()
      .single()
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced } = await supabaseAdmin()
          .from('contacts')
          .select('*')
          .eq('account_id', accountId)
          .eq('telegram_user_id', telegramUserId)
          .maybeSingle()
        if (raced) return { contact: raced, wasCreated: false }
      }
      console.error('Error creating telegram contact:', error)
      return null
    }
    return { contact: newContact, wasCreated: true }
  }

  // WhatsApp path — preserve exact existing behavior (phone NOT NULL before 041, now nullable but WA always has phone)
  const senderPhone = n.senderPhone
  const senderName = n.senderName
  if (!senderPhone) return null
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, senderPhone)
  if (existingContact) {
    if (senderName && senderName !== existingContact.name) {
      await supabaseAdmin().from('contacts').update({ name: senderName, updated_at: new Date().toISOString() }).eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({ account_id: accountId, user_id: configOwnerUserId, phone: senderPhone, name: senderName || senderPhone })
    .select()
    .single()
  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, senderPhone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }
  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversationUnified(accountId: string, configOwnerUserId: string, contactId: string) {
  // Unified single thread per (account,contact) — no channel predicate per approval
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findError) {
    console.error('Error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId })
    .select()
    .single()
  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return { conversation: raced[0], created: false }
    }
    console.error('Error creating conversation:', createError)
    return null
  }
  return { conversation: newConv, created: true }
}

/**
 * Provider-independent inbound processor.
 * Preserves exact WA ordering, idempotency, flow suppression, automation ordering, AI gating, webhook behavior.
 * Provider-specific fields come via NormalizedInbound (channel, providerMessageId, replyId, mediaUrl, etc.)
 */
export async function processNormalizedInbound(input: NormalizedInboundInput) {
  const channel: Channel = input.channel
  const accountId = input.accountId
  const configOwnerUserId = input.configOwnerUserId
  const providerMessageId = input.providerMessageId

  // 1) findOrCreateContact (channel-aware)
  const contactOutcome = await findOrCreateContactUnified(input)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // 2) findOrCreateConversation (unified)
  const convResult = await findOrCreateConversationUnified(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  // 3) conversation.created webhook before reaction short-circuit
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // 4) reaction short-circuit (kind === reaction)
  if (input.kind === 'reaction') {
    // input.replyId holds targetProviderId? For WA reaction, target is message_id; emoji in text
    // NormalizedInbound for reaction: providerMessageId is reaction's own id? Instead handle via raw
    // For WA, we need targetProviderId and emoji — passed via input.replyId (target) and input.text (emoji)
    // For simplicity, if kind reaction, treat replyId as target, text as emoji
    const targetId = input.targetProviderId ?? input.replyId
    const emoji = input.text
    if (targetId) {
      await handleReactionShared(conversation.id, contactRecord.id, targetId, emoji ?? null)
    }
    return
  }

  // Resolve reply context
  let replyToInternalId: string | null = null
  const replyToProviderId: string | null = input.replyToProviderId ?? null
  if (replyToProviderId) {
    replyToInternalId = await lookupInternalIdByMetaId(replyToProviderId, conversation.id)
    if (!replyToInternalId) console.warn('[inbound] reply context parent not found:', replyToProviderId)
  }

  // Content type mapping — trust input.contentType if provided, else derive from kind
  const allowed = new Set(['text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive'])
  let contentType: string = input.contentType ?? (input.kind === 'interactive_reply' ? 'interactive' : input.kind === 'media' ? 'image' : input.kind === 'location' ? 'location' : 'text')
  if (!allowed.has(contentType)) contentType = 'text'
  const contentText: string | null = input.contentText ?? input.text ?? null
  const mediaUrl: string | null = input.mediaUrl ?? null
  const mediaType: string | null = input.mediaType ?? null
  const interactiveReplyId: string | null = input.kind === 'interactive_reply' ? (input.replyId ?? null) : null

  // 8) isFirstInboundMessage before insert
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // 9) idempotent insert with channel provenance
  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: providerMessageId,
        channel,
        status: 'delivered',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id')

  if (msgError) {
    console.error('Error inserting message:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[inbound] duplicate inbound message ignored (idempotent replay):', providerMessageId)
    return
  }

  // 10) bump unread
  const { error: convError } = await supabaseAdmin().rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${contentType}]`,
  })
  if (convError) console.error('Error updating conversation:', convError)

  // 11) reopen
  await reopenClosedConversation(supabaseAdmin(), conversation)

  // 12) broadcast reply — WA only
  if (channel === 'whatsapp') {
    await flagBroadcastReplyIfAny(accountId, contactRecord.id)
  }

  // 13) flows — channel-aware trigger snapshot
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? { kind: 'interactive_reply', reply_id: interactiveReplyId, reply_title: contentText ?? '', meta_message_id: providerMessageId }
      : { kind: 'text', text: contentText ?? '', meta_message_id: providerMessageId },
    isFirstInboundMessage,
    channel: channel as import('@/lib/flows/types').FlowChannel,
  })
  const flowConsumed = flowResult.consumed

  // 14) automations
  const inboundText = contentText ?? ''
  const automationTriggers: Array<'new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match' | 'interactive_reply'> = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (interactiveReplyId) automationTriggers.push('interactive_reply')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
        trigger_channel: channel as 'whatsapp' | 'telegram' | null,
      },
    }).catch((err: unknown) => console.error('[automations] dispatch failed:', err))
  }

  // 15) AI — preserve !flowConsumed && !interactiveReplyId && trim gate
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  // 16) webhook message.received — additive channel field, WA compat whatsapp_message_id alias
  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: providerMessageId,
    provider_message_id: providerMessageId,
    channel,
    content_type: contentType,
    text: contentText,
  })
}
