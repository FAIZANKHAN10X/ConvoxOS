// ============================================================
// Inbound automation hooks — per-automation bearer tokens that let
// external systems (n8n, ManyChat middleware, scripts) fire native
// automations.
//
// One hook row per automation (UNIQUE(automation_id)). Two secrets,
// both shown exactly once at creation:
//   - bearer `token` in the URL (`/api/hooks/<token>`), stored as
//     SHA-256 hash (same pattern as `api_keys.key_hash`);
//   - HMAC `secret` for the `X-Wacrm-Signature` header, stored
//     AES-256-GCM-encrypted (same pattern as webhook secrets).
// ============================================================

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { hashApiKey } from '@/lib/api-keys/keys';
import { generateWebhookSecret } from '@/lib/webhooks/endpoints';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Bearer prefix — self-identifying in URLs and logs. */
export const HOOK_TOKEN_PREFIX = 'whk_';

export interface CreatedHook {
  id: string;
  /** Bearer token for the URL. Shown once — never stored. */
  token: string;
  /** HMAC signing secret. Shown once — stored encrypted. */
  secret: string;
}

export function generateHookToken(): string {
  return `${HOOK_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashHookToken(token: string): string {
  return hashApiKey(token);
}

interface HookRow {
  id: string;
  account_id: string;
  automation_id: string;
  secret_enc: string;
  is_active: boolean;
}

/**
 * Create (or rotate) the hook for an automation. Returns plaintext
 * credentials exactly once — the caller surfaces them and forgets.
 */
export async function createAutomationHook(
  db: SupabaseClient,
  args: { accountId: string; automationId: string; createdBy: string | null }
): Promise<CreatedHook> {
  const token = generateHookToken();
  const secret = generateWebhookSecret();
  const { data, error } = await db
    .from('automation_inbound_hooks')
    .upsert(
      {
        account_id: args.accountId,
        automation_id: args.automationId,
        created_by: args.createdBy,
        token_hash: hashHookToken(token),
        secret_enc: encrypt(secret),
        is_active: true,
      },
      { onConflict: 'automation_id' }
    )
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `failed to create inbound hook: ${error?.message ?? 'no row'}`
    );
  }
  return { id: (data as { id: string }).id, token, secret };
}

export async function findHookByTokenHash(
  db: SupabaseClient,
  tokenHash: string
): Promise<HookRow | null> {
  const { data, error } = await db
    .from('automation_inbound_hooks')
    .select('id, account_id, automation_id, secret_enc, is_active')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  return data as HookRow;
}

export function decryptHookSecret(secretEnc: string): string {
  return decrypt(secretEnc);
}

export async function revokeAutomationHook(
  db: SupabaseClient,
  args: { accountId: string; automationId: string }
): Promise<void> {
  const { error } = await db
    .from('automation_inbound_hooks')
    .delete()
    .eq('account_id', args.accountId)
    .eq('automation_id', args.automationId);
  if (error) {
    throw new Error(`failed to revoke inbound hook: ${error.message}`);
  }
}

export async function touchHookReceived(
  db: SupabaseClient,
  hookId: string
): Promise<void> {
  await db
    .from('automation_inbound_hooks')
    .update({ last_received_at: new Date().toISOString() })
    .eq('id', hookId);
}
