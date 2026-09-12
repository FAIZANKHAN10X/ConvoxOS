import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact } from '@/lib/api/v1/contacts';
import {
  emitContactCreated,
  emitContactUpdated,
} from '@/lib/automation/crm-events';
import { hashPatch, updateContact } from '@/lib/contacts/write';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

export class FormWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'FormWriteError';
    this.status = status;
  }
}

/** Fixed field vocabulary — no custom-field framework (out of scope). */
export const FORM_FIELD_TYPES = ['name', 'phone', 'email', 'company', 'message'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const formFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
});

export type FormField = z.infer<typeof formFieldSchema>;

/**
 * Normalize + validate a field list. Phone is a system field: always
 * present and required, since contacts are phone-keyed and a
 * phoneless lead can never enter automation.
 */
export function normalizeFormFields(input: unknown): FormField[] {
  const parsed = z.array(formFieldSchema).max(10).safeParse(input);
  if (!parsed.success) {
    throw new FormWriteError('Invalid form fields', 400);
  }
  const keys = new Set(parsed.data.map((f) => f.key));
  if (keys.size !== parsed.data.length) {
    throw new FormWriteError('Field keys must be unique', 400);
  }
  const withoutPhone = parsed.data.filter((f) => f.type !== 'phone');
  return [
    { key: 'phone', label: 'Phone', type: 'phone' as const, required: true },
    ...withoutPhone,
  ];
}

/** SHA-256 public-token scheme, mirroring inbound hooks. */
export function hashFormToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newFormToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

export interface LeadFormRow {
  id: string;
  account_id: string;
  name: string;
  fields: FormField[];
  is_active: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createLeadForm(
  db: SupabaseClient,
  input: { accountId: string; userId: string; name: string; fields: unknown }
): Promise<{ form: LeadFormRow; token: string }> {
  const name = input.name.trim();
  if (!name) throw new FormWriteError('Name is required', 400);
  const fields = normalizeFormFields(input.fields);
  const token = newFormToken();
  const { data, error } = await db
    .from('lead_forms')
    .insert({
      account_id: input.accountId,
      created_by: input.userId,
      name,
      public_token_hash: hashFormToken(token),
      fields,
      is_active: true,
    })
    .select('id, account_id, name, fields, is_active')
    .single();
  if (error || !data) {
    throw new FormWriteError(
      `Failed to create form: ${error?.message ?? 'no row'}`
    );
  }
  return { form: data as LeadFormRow, token };
}

export async function updateLeadForm(
  db: SupabaseClient,
  input: {
    accountId: string;
    formId: string;
    name?: string;
    fields?: unknown;
    isActive?: boolean;
  }
): Promise<LeadFormRow> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new FormWriteError('Name is required', 400);
    patch.name = name;
  }
  if (input.fields !== undefined) {
    patch.fields = normalizeFormFields(input.fields);
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) {
    throw new FormWriteError('Nothing to update', 400);
  }
  const { data, error } = await db
    .from('lead_forms')
    .update(patch)
    .eq('id', input.formId)
    .eq('account_id', input.accountId)
    .select('id, account_id, name, fields, is_active')
    .single();
  if (error || !data) {
    throw new FormWriteError('Form not found', 404);
  }
  return data as LeadFormRow;
}

export async function findFormByTokenHash(
  db: SupabaseClient,
  tokenHash: string
): Promise<(LeadFormRow & { account_id: string }) | null> {
  const { data, error } = await db
    .from('lead_forms')
    .select('id, account_id, name, fields, is_active')
    .eq('public_token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  return data as LeadFormRow & { account_id: string };
}

export interface SubmissionAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
}

export interface IngestResult {
  submission: Record<string, unknown>;
  contactId: string;
  contactCreated: boolean;
  deduped: boolean;
}

/**
 * Validate values against the form schema, upsert the contact
 * (emitting contact_created/contact_updated like every path), and
 * record the submission. `submissionKey` collapses double-submits:
 * a known key returns the original row without side effects.
 */
export async function ingestSubmission(
  db: SupabaseClient,
  input: {
    accountId: string;
    auditUserId: string;
    form: LeadFormRow;
    values: Record<string, unknown>;
    attribution?: SubmissionAttribution;
    submissionKey?: string;
  }
): Promise<IngestResult> {
  const fields = input.form.fields;
  const clean: Record<string, string> = {};
  for (const field of fields) {
    const raw = input.values[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !value) {
      throw new FormWriteError(`'${field.label}' is required`, 400);
    }
    if (value && field.type === 'email' && !EMAIL_RE.test(value)) {
      throw new FormWriteError(`'${field.label}' must be a valid email`, 400);
    }
    if (value) clean[field.key] = value;
  }

  const phone = sanitizePhoneForMeta(clean.phone ?? '');
  if (!isValidE164(phone)) {
    throw new FormWriteError("'Phone' must be a valid phone number", 400);
  }

  if (input.submissionKey) {
    const { data: prior } = await db
      .from('form_submissions')
      .select('id, contact_id')
      .eq('form_id', input.form.id)
      .eq('submission_key', input.submissionKey)
      .maybeSingle();
    if (prior) {
      const row = prior as { id: string; contact_id: string };
      const { data: full } = await db
        .from('form_submissions')
        .select('*')
        .eq('id', row.id)
        .maybeSingle();
      return {
        submission: (full ?? prior) as Record<string, unknown>,
        contactId: row.contact_id,
        contactCreated: false,
        deduped: true,
      };
    }
  }

  const { id: contactId, created } = await findOrCreateContact(
    db,
    input.accountId,
    input.auditUserId,
    {
      phone,
      name: clean.name,
      email: clean.email,
      company: clean.company,
    }
  );
  if (created) {
    await emitContactCreated({
      db,
      accountId: input.accountId,
      contactId,
      payload: { source: 'form', form_id: input.form.id },
      idempotencyKey: `contact_created:${contactId}`,
      source: 'crm',
    });
  } else {
    const patch: Record<string, string | undefined> = {};
    if (clean.name !== undefined) patch.name = clean.name;
    if (clean.email !== undefined) patch.email = clean.email;
    if (clean.company !== undefined) patch.company = clean.company;
    if (Object.keys(patch).length > 0) {
      const updated = await updateContact(db, {
        accountId: input.accountId,
        contactId,
        patch,
      });
      if (updated.changedFields.length > 0) {
        await emitContactUpdated({
          db,
          accountId: input.accountId,
          contactId,
          payload: {
            fields: updated.changedFields,
            source: 'form',
            form_id: input.form.id,
          },
          idempotencyKey: `contact_updated:${contactId}:form:${hashPatch(patch)}`,
          source: 'crm',
        });
      }
    }
  }

  const attribution: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.attribution ?? {})) {
    if (typeof value === 'string' && value.trim()) {
      attribution[key] = value.trim().slice(0, 500);
    }
  }

  const { data: submission, error } = await db
    .from('form_submissions')
    .insert({
      account_id: input.accountId,
      form_id: input.form.id,
      contact_id: contactId,
      values: clean,
      attribution,
      submission_key: input.submissionKey ?? null,
    })
    .select('*')
    .single();
  if (error || !submission) {
    // Lost a double-submit race after the lookup — re-resolve.
    if ((error as { code?: string })?.code === '23505' && input.submissionKey) {
      const { data: raced } = await db
        .from('form_submissions')
        .select('*')
        .eq('form_id', input.form.id)
        .eq('submission_key', input.submissionKey)
        .maybeSingle();
      if (raced) {
        const row = raced as { contact_id: string };
        return {
          submission: raced as Record<string, unknown>,
          contactId: row.contact_id,
          contactCreated: false,
          deduped: true,
        };
      }
    }
    throw new FormWriteError(
      `Failed to record submission: ${error?.message ?? 'no row'}`
    );
  }
  return {
    submission: submission as Record<string, unknown>,
    contactId,
    contactCreated: created,
    deduped: false,
  };
}
