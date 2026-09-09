import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { createPostgresStore, saveDraft } from '@/lib/automation';
import type { AutomationGraph } from '@/lib/automation';

function isGraph(value: unknown): value is AutomationGraph {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as AutomationGraph).nodes) &&
    Array.isArray((value as AutomationGraph).edges)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const store = createPostgresStore(ctx.supabase);
    const automation = await store.getAutomation(id);
    if (!automation || automation.accountId !== ctx.accountId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ automation });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
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

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      graph?: unknown;
    } | null;

    let automation = existing;
    if (typeof body?.name === 'string' && body.name.trim()) {
      automation = await store.updateAutomation(id, {
        name: body.name.trim(),
      });
    }
    if (isGraph(body?.graph)) {
      automation = await saveDraft(store, id, body.graph);
    }
    return NextResponse.json({ automation });
  } catch (error) {
    return toErrorResponse(error);
  }
}
