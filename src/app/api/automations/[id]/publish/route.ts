import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  AutomationPublishError,
  createPostgresStore,
  defaultRegistry,
  publishAutomation,
} from '@/lib/automation';

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
      const automation = await publishAutomation(
        store,
        defaultRegistry,
        id,
        ctx.userId
      );
      return NextResponse.json({ automation });
    } catch (error) {
      if (error instanceof AutomationPublishError) {
        return NextResponse.json(
          { error: error.message, issues: error.issues },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
