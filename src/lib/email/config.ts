// Email config store — mirrors telegram_config conventions:
// encrypted secrets, one row per account, admin-only writes.

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/crypto/encryption';

import { verifyResendApiKey, ResendApiError } from './resend';

export class EmailConfigError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'EmailConfigError';
    this.code = code;
    this.status = status;
  }
}

export interface EmailConfig {
  id: string;
  account_id: string;
  from_address: string;
  from_name: string | null;
  status: 'connected' | 'disconnected';
  connected_at: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertEmailAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) {
    throw new EmailConfigError('bad_request', `'${field}' must be a valid email address`, 400);
  }
  return value.trim();
}

/** Decrypt-and-return the API key; throws EmailConfigError on any failure. */
export async function getEmailApiKey(
  db: SupabaseClient,
  accountId: string
): Promise<{ configId: string; apiKey: string; from: string; replyTo: string }> {
  const { data: config, error } = await db
    .from('email_config')
    .select('id, api_key_encrypted, from_address, from_name, status')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !config) {
    throw new EmailConfigError(
      'email_not_configured',
      'Email not configured. Connect Resend in Settings → Channels first.',
      400
    );
  }
  if ((config as { status: string }).status !== 'connected') {
    throw new EmailConfigError(
      'email_disconnected',
      'Email is disconnected. Reconnect in Settings → Channels first.',
      400
    );
  }
  let apiKey: string;
  try {
    apiKey = decrypt((config as { api_key_encrypted: string }).api_key_encrypted);
  } catch {
    throw new EmailConfigError(
      'decrypt_failed',
      'Failed to decrypt the Resend API key. Please reconnect email.',
      500
    );
  }
  const row = config as { id: string; from_address: string; from_name: string | null };
  const from = row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address;
  return { configId: row.id, apiKey, from, replyTo: row.from_address };
}

/**
 * Validate the key against Resend, then upsert the config. Generates
 * a fresh webhook secret on first connect (rotation on reconnect).
 * Returns the config plus the one-time webhook secret + URL for the
 * operator to paste into the Resend dashboard.
 */
export async function connectEmail(
  db: SupabaseClient,
  input: {
    accountId: string;
    userId: string;
    apiKey: string;
    fromAddress: string;
    fromName?: string;
    appOrigin: string;
  }
): Promise<{ config: EmailConfig; webhookSecret: string; webhookUrl: string }> {
  const fromAddress = assertEmailAddress(input.fromAddress, 'from_address');
  if (!input.apiKey.trim()) {
    throw new EmailConfigError('bad_request', "'api_key' is required", 400);
  }
  try {
    await verifyResendApiKey(input.apiKey.trim());
  } catch (err) {
    if (err instanceof ResendApiError) {
      throw new EmailConfigError(err.code, err.message, err.status);
    }
    throw err;
  }

  const webhookSecret = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const { data, error } = await db
    .from('email_config')
    .upsert(
      {
        account_id: input.accountId,
        created_by: input.userId,
        api_key_encrypted: encrypt(input.apiKey.trim()),
        from_address: fromAddress,
        from_name: input.fromName?.trim() || null,
        webhook_secret_encrypted: encrypt(webhookSecret),
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    )
    .select('id, account_id, from_address, from_name, status, connected_at')
    .single();
  if (error || !data) {
    throw new EmailConfigError(
      'db_error',
      `Failed to save email config: ${error?.message ?? 'no row'}`,
      500
    );
  }
  const row = data as unknown as EmailConfig;
  return {
    config: row,
    webhookSecret,
    webhookUrl: `${input.appOrigin}/api/email/webhook/${row.id}`,
  };
}

export async function disconnectEmail(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  // Hard-delete preserves messages/conversations history (FK-free).
  const { error } = await db.from('email_config').delete().eq('account_id', accountId);
  if (error) {
    throw new EmailConfigError('db_error', `Failed to disconnect: ${error.message}`, 500);
  }
}
