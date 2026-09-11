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
import { extractTrigger } from '@/lib/automation/graph';
import { bindHookIdInGraph } from '@/lib/automation/nodes/inbound-webhook';
import type { AutomationGraph } from '@/lib/automation/types';
import { generateWebhookSecret } from '@/lib/webhooks/endpoints';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Bearer prefix — self-identifying in URLs and logs. */
export const HOOK_TOKEN_PREFIX = 'whk_';

export interface CreatedHook {
  id: string;
  /** Bearer token for the URL. Shown once as plaintext (also stored encrypted). */
  token: string;
  /** HMAC signing secret. Shown once — stored encrypted. */
  secret: string;
}

export interface PublicHook {
  id: string;
  automation_id: string;
  is_active: boolean;
  last_received_at: string | null;
  created_at: string;
  /** Reconstructed from token_enc when present. HMAC secret is never included. */
  url: string | null;
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
        token_enc: encrypt(token),
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
  const created = { id: (data as { id: string }).id, token, secret };
  await bindDraftHookId(db, args.automationId, created.id);
  return created;
}

export function hookUrlFromToken(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/hooks/${token}`;
}

export function decryptHookToken(tokenEnc: string): string {
  return decrypt(tokenEnc);
}

export function publicHookFromRow(
  row: Record<string, unknown>,
  origin: string
): PublicHook {
  let url: string | null = null;
  const tokenEnc = row.token_enc;
  if (typeof tokenEnc === 'string' && tokenEnc) {
    try {
      url = hookUrlFromToken(origin, decryptHookToken(tokenEnc));
    } catch {
      url = null;
    }
  }
  return {
    id: row.id as string,
    automation_id: row.automation_id as string,
    is_active: Boolean(row.is_active),
    last_received_at: (row.last_received_at as string | null) ?? null,
    created_at: row.created_at as string,
    url,
  };
}

async function bindDraftHookId(
  db: SupabaseClient,
  automationId: string,
  hookId: string
): Promise<void> {
  try {
    const { data, error } = await db
      .from('automations')
      .select('draft_graph')
      .eq('id', automationId)
      .maybeSingle();
    if (error || !data) return;
    const graph = data.draft_graph as AutomationGraph | null;
    if (!graph || !Array.isArray(graph.nodes)) return;
    const next = bindHookIdInGraph(graph, hookId);
    const trigger = extractTrigger(next);
    await db
      .from('automations')
      .update({ draft_graph: next, draft_trigger: trigger })
      .eq('id', automationId);
  } catch (error) {
    console.error('[integrations] failed to stamp inbound hook on draft', error);
  }
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
