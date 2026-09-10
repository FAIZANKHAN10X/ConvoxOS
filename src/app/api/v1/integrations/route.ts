// ============================================================
// GET  /api/v1/integrations — list endpoints  (scope: integrations:manage)
// POST /api/v1/integrations — register one   (scope: integrations:manage)
//
// POST returns the signing `secret` in plaintext exactly once —
// paste it into the receiving system (n8n credential / verifier).
// ConvoxOS keeps only an encrypted copy and can never show it again.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  createIntegrationEndpoint,
  INTEGRATION_SECRET_PREFIX,
} from '@/lib/integrations/endpoints';
import { normalizeWebhookUrl } from '@/lib/webhooks/endpoints';

const PUBLIC_COLUMNS =
  'id, name, kind, url, is_active, last_delivery_at, failure_count, created_at';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'integrations:manage');

    const { data, error } = await ctx.supabase
      .from('integration_endpoints')
      .select(PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/integrations] list error:', error);
      return fail('internal', 'Failed to list integrations', 500);
    }
    return okList((data ?? []) as Record<string, unknown>[], null);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'integrations:manage');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return fail('bad_request', "'name' is required", 400);

    const kind = body.kind === 'generic' ? 'generic' : 'n8n';

    const url = normalizeWebhookUrl(body.url);
    if (!url) {
      return fail('bad_request', "'url' must be a valid https:// URL", 400);
    }

    const created = await createIntegrationEndpoint(ctx.supabase, {
      accountId: ctx.accountId,
      createdBy: ctx.createdBy,
      name,
      kind,
      url,
    });

    // Secret shown exactly once.
    return ok(
      {
        id: created.id,
        name,
        kind,
        url,
        secret: created.secret,
        secret_prefix: INTEGRATION_SECRET_PREFIX,
      },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
