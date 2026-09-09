import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  createPostgresStore,
  mapAutomation,
  starterGraph,
} from '@/lib/automation';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('automations')
      .select('*')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      automations: (data ?? []).map((row) =>
        mapAutomation(row as Record<string, unknown>)
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const store = createPostgresStore(ctx.supabase);
    const automation = await store.insertAutomation({
      accountId: ctx.accountId,
      createdBy: ctx.userId,
      name: 'Untitled automation',
      draftGraph: starterGraph(),
    });
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
