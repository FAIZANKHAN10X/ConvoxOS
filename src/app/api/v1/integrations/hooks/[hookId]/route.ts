// ============================================================
// DELETE /api/v1/integrations/hooks/[hookId] — revoke an inbound
// hook (scope: integrations:manage). The URL stops working
// immediately; deliveries in flight fail closed.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ hookId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'integrations:manage');
    const { hookId } = await params;

    const { error, count } = await ctx.supabase
      .from('automation_inbound_hooks')
      .delete({ count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('id', hookId);

    if (error) {
      console.error('[api/v1/integrations/hooks] delete error:', error);
      return fail('internal', 'Failed to delete inbound hook', 500);
    }
    if (!count) return fail('not_found', 'Inbound hook not found', 404);
    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
