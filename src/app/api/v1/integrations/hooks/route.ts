// ============================================================
// GET  /api/v1/integrations/hooks — list inbound hooks (secret-free)
// POST /api/v1/integrations/hooks — create/rotate one for an automation
// (scope: integrations:manage)
//
// POST body: `{ "automation_id": "<uuid>" }`. The automation must
// belong to the key's account. Returns the hook `url` (absolute,
// built from this request's origin), bearer `token`, and HMAC
// `secret` — all exactly once. Rotating (POST again for the same
// automation) invalidates the previous pair.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { createAutomationHook } from '@/lib/integrations/hooks';

const PUBLIC_COLUMNS =
  'id, automation_id, is_active, last_received_at, created_at';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'integrations:manage');

    const { data, error } = await ctx.supabase
      .from('automation_inbound_hooks')
      .select(PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/integrations/hooks] list error:', error);
      return fail('internal', 'Failed to list inbound hooks', 500);
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
    const automationId =
      body && typeof body.automation_id === 'string' ? body.automation_id : '';
    if (!automationId) {
      return fail('bad_request', "'automation_id' is required", 400);
    }

    const { data: automation, error: lookupError } = await ctx.supabase
      .from('automations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('id', automationId)
      .maybeSingle();
    if (lookupError || !automation) {
      return fail('not_found', 'Automation not found', 404);
    }

    const created = await createAutomationHook(ctx.supabase, {
      accountId: ctx.accountId,
      automationId,
      createdBy: ctx.createdBy,
    });
    const origin = new URL(request.url).origin;

    // Credentials shown exactly once.
    return ok(
      {
        id: created.id,
        automation_id: automationId,
        url: `${origin}/api/hooks/${created.token}`,
        token: created.token,
        secret: created.secret,
      },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
