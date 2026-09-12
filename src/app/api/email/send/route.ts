import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendEmailToConversation, SendEmailError } from '@/lib/email/send';

/**
 * POST /api/email/send — manual agent email. Mirrors the telegram
 * send route: conversation- or contact-scoped, validated, then the
 * email module owns provider send + persistence.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`send-email:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const conversationId =
      typeof body?.conversation_id === 'string' ? body.conversation_id : null;
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : null;
    const subject =
      typeof body?.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : null;
    const contentText =
      typeof body?.content_text === 'string' ? body.content_text : null;
    const replyToMessageId =
      typeof body?.reply_to_message_id === 'string' ? body.reply_to_message_id : null;
    if ((!conversationId && !contactId) || !contentText?.trim()) {
      return NextResponse.json(
        { error: "'conversation_id' (or 'contact_id') and 'content_text' are required" },
        { status: 400 }
      );
    }

    let resolvedConversationId = conversationId;
    if (!resolvedConversationId && contactId) {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (convError || !conv) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      resolvedConversationId = (conv as { id: string }).id;
    }
    if (resolvedConversationId) {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', resolvedConversationId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (convError || !conv) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
    }

    // Empty subjects fall back to the thread (Re: last subject) so
    // quick replies stay one-field.
    let resolvedSubject = subject;
    if (!resolvedSubject && resolvedConversationId) {
      const { data: last } = await supabase
        .from('messages')
        .select('subject')
        .eq('conversation_id', resolvedConversationId)
        .eq('channel', 'email')
        .not('subject', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const prior = (last as { subject?: string } | null)?.subject?.trim();
      resolvedSubject = prior
        ? /^re:/i.test(prior)
          ? prior
          : `Re: ${prior}`
        : 'Follow-up';
    }

    const sent = await sendEmailToConversation(supabase, accountId, {
      conversationId: resolvedConversationId as string,
      subject: resolvedSubject,
      contentText,
      replyToMessageId,
    });
    return NextResponse.json({
      message_id: sent.messageId,
      email_id: sent.emailId,
    });
  } catch (error) {
    if (error instanceof SendEmailError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
