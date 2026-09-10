// ============================================================
// Integration endpoints — named references to external systems
// (n8n webhook URLs, generic APIs) that automation nodes can call.
//
// Secrets follow the webhook-endpoints convention exactly:
// AES-256-GCM at rest, plaintext shown once at creation, never
// selected back. Runtime delivery reuses the shared safe-fetch
// policy plus per-endpoint HMAC signing.
// ============================================================

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Secret prefix — self-identifying, like `whsec_` for webhooks. */
export const INTEGRATION_SECRET_PREFIX = 'intsec_';

export interface CreatedEndpoint {
  id: string;
  /** HMAC signing secret. Shown once — stored encrypted. */
  secret: string;
}

export function generateIntegrationSecret(): string {
  return `${INTEGRATION_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export interface IntegrationEndpointRow {
  id: string;
  account_id: string;
  name: string;
  kind: string;
  url: string;
  secret_enc: string;
  is_active: boolean;
}

export async function createIntegrationEndpoint(
  db: SupabaseClient,
  args: {
    accountId: string;
    createdBy: string | null;
    name: string;
    kind: string;
    url: string;
  }
): Promise<CreatedEndpoint> {
  const secret = generateIntegrationSecret();
  const { data, error } = await db
    .from('integration_endpoints')
    .insert({
      account_id: args.accountId,
      created_by: args.createdBy,
      name: args.name,
      kind: args.kind,
      url: args.url,
      secret_enc: encrypt(secret),
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `failed to create integration endpoint: ${error?.message ?? 'no row'}`
    );
  }
  return { id: (data as { id: string }).id, secret };
}

export async function getIntegrationEndpoint(
  db: SupabaseClient,
  args: { accountId: string; endpointId: string }
): Promise<IntegrationEndpointRow | null> {
  const { data, error } = await db
    .from('integration_endpoints')
    .select('id, account_id, name, kind, url, secret_enc, is_active')
    .eq('account_id', args.accountId)
    .eq('id', args.endpointId)
    .maybeSingle();
  if (error || !data) return null;
  return data as IntegrationEndpointRow;
}

export function decryptEndpointSecret(secretEnc: string): string {
  return decrypt(secretEnc);
}
