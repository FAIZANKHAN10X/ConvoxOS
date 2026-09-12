import type { SupabaseClient } from '@supabase/supabase-js';

export class EmailTemplateError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'EmailTemplateError';
    this.status = status;
  }
}

export interface EmailTemplateRow {
  id: string;
  account_id: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string | null;
}

const COLUMNS = 'id, account_id, name, subject, body_text, body_html';

function validate(input: { name?: unknown; subject?: unknown; bodyText?: unknown; bodyHtml?: unknown }) {
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new EmailTemplateError('Name is required', 400);
    }
    if (input.name.trim().length > 120) {
      throw new EmailTemplateError('Name exceeds 120 characters', 400);
    }
  }
  if (input.subject !== undefined) {
    if (typeof input.subject !== 'string' || !input.subject.trim()) {
      throw new EmailTemplateError('Subject is required', 400);
    }
    if (input.subject.trim().length > 500) {
      throw new EmailTemplateError('Subject exceeds 500 characters', 400);
    }
  }
  if (input.bodyText !== undefined && typeof input.bodyText !== 'string') {
    throw new EmailTemplateError('body_text must be a string', 400);
  }
  if (
    input.bodyHtml !== undefined &&
    input.bodyHtml !== null &&
    typeof input.bodyHtml !== 'string'
  ) {
    throw new EmailTemplateError('body_html must be a string or null', 400);
  }
}

export async function createEmailTemplate(
  db: SupabaseClient,
  input: {
    accountId: string;
    userId: string;
    name: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
  }
): Promise<EmailTemplateRow> {
  validate(input);
  if (!input.bodyText.trim() && !(input.bodyHtml ?? '').trim()) {
    throw new EmailTemplateError('Body text or HTML is required', 400);
  }
  const { data, error } = await db
    .from('email_templates')
    .insert({
      account_id: input.accountId,
      created_by: input.userId,
      name: input.name.trim(),
      subject: input.subject.trim(),
      body_text: input.bodyText,
      body_html:
        input.bodyHtml != null && input.bodyHtml.trim() !== ''
          ? input.bodyHtml
          : null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new EmailTemplateError('A template with this name already exists', 409);
    }
    throw new EmailTemplateError(
      `Failed to create template: ${error?.message ?? 'no row'}`
    );
  }
  return data as EmailTemplateRow;
}

export async function updateEmailTemplate(
  db: SupabaseClient,
  input: {
    accountId: string;
    templateId: string;
    name?: string;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
  }
): Promise<EmailTemplateRow> {
  validate(input);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = (input.name as string).trim();
  if (input.subject !== undefined) patch.subject = (input.subject as string).trim();
  if (input.bodyText !== undefined) patch.body_text = input.bodyText;
  if (input.bodyHtml !== undefined) {
    patch.body_html =
      input.bodyHtml != null && input.bodyHtml.trim() !== '' ? input.bodyHtml : null;
  }
  if (Object.keys(patch).length === 0) {
    throw new EmailTemplateError('Nothing to update', 400);
  }
  const { data, error } = await db
    .from('email_templates')
    .update(patch)
    .eq('id', input.templateId)
    .eq('account_id', input.accountId)
    .select(COLUMNS)
    .single();
  if (error || !data) {
    if ((error as { code?: string })?.code === '23505') {
      throw new EmailTemplateError('A template with this name already exists', 409);
    }
    throw new EmailTemplateError('Template not found', 404);
  }
  return data as EmailTemplateRow;
}

export async function getEmailTemplate(
  db: SupabaseClient,
  accountId: string,
  templateId: string
): Promise<EmailTemplateRow | null> {
  const { data, error } = await db
    .from('email_templates')
    .select(COLUMNS)
    .eq('id', templateId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as EmailTemplateRow;
}
