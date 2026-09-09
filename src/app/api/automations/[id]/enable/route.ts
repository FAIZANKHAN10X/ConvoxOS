import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createPostgresStore, enableAutomation } from '@/lib/automation';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    const store = createPostgresStore(ctx.supabase);
    const existing = await store.getAutomation(id);
    if (!existing || existing.accountId !== ctx.accountId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    try {
      const automation = await enableAutomation(store, id);
      return NextResponse.json({ automation });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Cannot enable' },
        { status: 400 }
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
