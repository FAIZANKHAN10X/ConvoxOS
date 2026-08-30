import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendTelegramMedia } from '@/lib/channels/telegram/send-media';
import { SendTelegramError } from '@/lib/channels/telegram/send';
import { validateTelegramInlineMarkup } from '@/lib/channels/telegram/keyboard';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`send-telegram:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    const {
      conversation_id: conversationId,
      contact_id,
      media_url: mediaUrl,
      media_kind: mediaKindRaw,
      filename,
      caption,
      reply_to_message_id: replyToMessageId,
      reply_markup,
    } = body as {
      conversation_id?: string;
      contact_id?: string;
      media_url?: string;
      media_kind?: string;
      filename?: string;
      caption?: string;
      reply_to_message_id?: string;
      reply_markup?: unknown;
    };

    const allowedKinds = new Set(['image', 'document', 'video', 'audio', 'voice']);
    const mediaKind = (mediaKindRaw && allowedKinds.has(mediaKindRaw) ? mediaKindRaw : null) as 'image' | 'document' | 'video' | 'audio' | 'voice' | null;
    if ((!conversationId && !contact_id) || !mediaUrl || !mediaKind) {
      return NextResponse.json({ error: 'conversation_id|contact_id, media_url and media_kind (image|document|video|audio|voice) are required' }, { status: 400 });
    }
    if (caption && caption.length > 1024) {
      return NextResponse.json({ error: 'Caption exceeds 1024 characters' }, { status: 400 });
    }
    let inlineKeyboard: import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup | null = null;
    if (reply_markup !== undefined && reply_markup !== null) {
      let parsed: unknown = reply_markup;
      if (typeof reply_markup === 'string') {
        try {
          parsed = JSON.parse(reply_markup);
        } catch {
          return NextResponse.json({ error: 'reply_markup must be valid JSON' }, { status: 400 });
        }
      }
      const v = validateTelegramInlineMarkup(parsed);
      if (!v.ok) return NextResponse.json({ error: (v as { error: string }).error }, { status: 400 });
      inlineKeyboard = parsed as import('@/lib/channels/telegram/keyboard').TelegramInlineMarkup;
    }

    let conversationIdResolved = conversationId ?? null;
    if (!conversationIdResolved && contact_id) {
      const { data: contactRow, error: cErr } = await supabase.from('contacts').select('id').eq('id', contact_id).eq('account_id', accountId).maybeSingle();
      if (cErr || !contactRow) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      const resolved = await findOrCreateConversation(supabase, accountId, userId, contact_id);
      if (!resolved) return NextResponse.json({ error: 'Failed to open conversation' }, { status: 500 });
      conversationIdResolved = resolved;
    } else if (conversationIdResolved) {
      const { data, error } = await supabase.from('conversations').select('id').eq('id', conversationIdResolved).eq('account_id', accountId).maybeSingle();
      if (error || !data) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (!conversationIdResolved) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const result = await sendTelegramMedia(supabase, accountId, {
      conversationId: conversationIdResolved,
      mediaUrl,
      mediaKind,
      filename: filename ?? null,
      caption: caption ?? null,
      replyToMessageId: replyToMessageId ?? null,
      inlineKeyboard,
    });

    return NextResponse.json({ success: true, message_id: result.messageId, telegram_message_id: result.telegramMessageId });
  } catch (err) {
    if (err instanceof SendTelegramError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}

type Supa = Awaited<ReturnType<typeof createClient>>;
async function findOrCreateConversation(supabase: Supa, accountId: string, userId: string, contactId: string): Promise<string | null> {
  const { data: existing } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('contact_id', contactId).maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await supabase.from('conversations').insert({ account_id: accountId, user_id: userId, contact_id: contactId }).select('id').single();
  if (error) return null;
  return created.id as string;
}
