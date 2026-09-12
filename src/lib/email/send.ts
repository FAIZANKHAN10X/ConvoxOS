// Provider-specific Resend email sender — mirrors
// channels/telegram/send.ts conventions (idempotency guard,
// account-scoped conversation+contact load, encrypted config,
// persist with channel provenance, preview bump).

import type { SupabaseClient } from '@supabase/supabase-js';

import { getEmailApiKey, EmailConfigError } from './config';
import { sendResendEmail, ResendApiError } from './resend';

export class SendEmailError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.name = 'SendEmailError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface SendEmailParams {
  conversationId: string;
  subject: string | null;
  contentText: string | null;
  contentHtml?: string | null;
  replyToMessageId?: string | null;
  /**
   * Stable automation key (run:node:block). Short-circuits on an
   * already-persisted row so engine retries never double-send.
   */
  idempotencyKey?: string | null;
  /** Provider idempotency key override (defaults to the row key). */
  providerIdempotencyKey?: string | null;
}

export interface SendEmailResult {
  messageId: string; // our messages.id
  emailId: string; // Resend id
}

const EMAIL_TEXT_LIMIT = 100_000;

function validateEmailContent(subject: string | null, text: string | null, html?: string | null) {
  if (!subject || !subject.trim()) {
    throw new SendEmailError('bad_request', 'subject is required for email', 400);
  }
  if (subject.trim().length > 500) {
    throw new SendEmailError('bad_request', 'subject exceeds 500 characters', 400);
  }
  if (!text?.trim() && !html?.trim()) {
    throw new SendEmailError('bad_request', 'text or HTML body is required', 400);
  }
  if ((text?.length ?? 0) > EMAIL_TEXT_LIMIT) {
    throw new SendEmailError('bad_request', 'text body exceeds size limit', 400);
  }
}

function toSendError(err: unknown): SendEmailError {
  if (err instanceof SendEmailError) return err;
  if (err instanceof EmailConfigError) {
    return new SendEmailError('email_not_configured', err.message, err.status);
  }
  if (err instanceof ResendApiError) {
    return new SendEmailError(err.code, err.message, err.status, err.retryable);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SendEmailError('email_error', `Email send failed: ${message}`, 502, true);
}

export async function sendEmailToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendEmailParams
): Promise<SendEmailResult> {
  const { conversationId, subject, contentText } = params;
  if (!conversationId) {
    throw new SendEmailError('bad_request', 'conversation_id is required', 400);
  }
  validateEmailContent(subject, contentText, params.contentHtml);

  // Automation retry guard — reuse an already-persisted block send.
  if (params.idempotencyKey) {
    const { data: existing } = await db
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', conversationId)
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        messageId: existing.id as string,
        emailId: (existing.message_id as string | null)?.replace(/^resend_/, '') ?? '',
      };
    }
  }

  // Load conversation + contact (account-scoped).
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();
  if (convError || !conversation) {
    throw new SendEmailError('not_found', 'Conversation not found', 404);
  }
  type EmailContact = { id: string; email: string | null; name: string | null };
  const contact = (conversation as unknown as { contact: EmailContact | null }).contact;
  if (!contact?.email) {
    throw new SendEmailError('bad_request', 'Contact does not have an email address', 400);
  }

  const { apiKey, from, replyTo } = await getEmailApiKey(db, accountId).catch((err) => {
    throw toSendError(err);
  });

  // Threading: resolve reply target provider id for headers.
  let replyToInternalId: string | null = null;
  const threadHeaders: Record<string, string> = {};
  if (params.replyToMessageId) {
    const { data: parent } = await db
      .from('messages')
      .select('id, message_id')
      .eq('id', params.replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (parent) {
      replyToInternalId = parent.id as string;
      const parentProvider = parent.message_id as string | null;
      if (parentProvider) {
        const bare = parentProvider.replace(/^resend_(in_)?/, '');
        threadHeaders['In-Reply-To'] = bare;
        threadHeaders['References'] = bare;
      }
    }
  }

  let emailId: string;
  try {
    ({ id: emailId } = await sendResendEmail(apiKey, {
      from,
      to: [contact.email],
      subject: subject!.trim(),
      text: contentText ?? undefined,
      html: params.contentHtml ?? undefined,
      replyTo,
      headers: Object.keys(threadHeaders).length > 0 ? threadHeaders : undefined,
      idempotencyKey:
        params.providerIdempotencyKey ?? params.idempotencyKey ?? undefined,
    }));
  } catch (err) {
    throw toSendError(err);
  }

  const providerMessageId = `resend_${emailId}`;
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: contentText,
      subject: subject!.trim(),
      channel: 'email',
      message_id: providerMessageId,
      status: 'sent',
      reply_to_message_id: replyToInternalId,
      ...(params.idempotencyKey ? { idempotency_key: params.idempotencyKey } : {}),
    })
    .select()
    .single();
  if (msgError) {
    console.error('[email-send] error inserting sent message:', msgError);
    throw new SendEmailError(
      'db_error',
      `Message sent via Resend but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: subject!.trim(),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { messageId: (messageRecord as { id: string }).id, emailId };
}
