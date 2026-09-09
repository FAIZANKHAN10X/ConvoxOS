import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createPostgresStore } from '@/lib/automation';

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
    const automation = await store.insertAutomation({
      accountId: ctx.accountId,
      createdBy: ctx.userId,
      name: `${existing.name} copy`,
      draftGraph: existing.draftGraph,
      draftTrigger: existing.draftTrigger,
    });
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
