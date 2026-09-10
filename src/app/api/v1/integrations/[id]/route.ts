// ============================================================
// DELETE /api/v1/integrations/[id] — revoke an endpoint
// (scope: integrations:manage). Deletion is hard; in-flight runs
// fail closed with "endpoint missing or disabled" instead.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'integrations:manage');
    const { id } = await params;

    const { error, count } = await ctx.supabase
      .from('integration_endpoints')
      .delete({ count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('id', id);

    if (error) {
      console.error('[api/v1/integrations] delete error:', error);
      return fail('internal', 'Failed to delete integration', 500);
    }
    if (!count) return fail('not_found', 'Integration not found', 404);
    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
