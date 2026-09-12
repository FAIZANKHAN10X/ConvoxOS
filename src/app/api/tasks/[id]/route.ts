import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { completeTask, TaskWriteError } from '@/lib/tasks/write';

/**
 * GET /api/tasks/[id] — single task, account-scoped.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('id, title, description, status, due_at, contact_id, assigned_to, deal_id, created_at, updated_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ task: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/tasks/[id] — complete via the domain writer (emits
 * `task_completed`) or edit whitelisted fields (no event exists
 * for edits — direct account-scoped update, same as deal fields).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      title?: unknown;
      description?: unknown;
      due_at?: unknown;
      assigned_to?: unknown;
      contact_id?: unknown;
      deal_id?: unknown;
    } | null;

    if (body?.action === 'complete') {
      const result = await completeTask(ctx.supabase, {
        accountId: ctx.accountId,
        taskId: id,
      });
      return NextResponse.json({ task: result.task, completed: result.completed });
    }

    // Field edits: whitelist + per-reference ownership checks.
    const patch: Record<string, unknown> = {};
    if (typeof body?.title === 'string' && body.title.trim()) {
      patch.title = body.title.trim();
    }
    if (body?.description !== undefined) {
      patch.description =
        typeof body.description === 'string' && body.description ? body.description : null;
    }
    if (body?.due_at !== undefined) {
      if (body.due_at && (typeof body.due_at !== 'string' || Number.isNaN(new Date(body.due_at).getTime()))) {
        return NextResponse.json({ error: 'due_at must be a valid datetime' }, { status: 400 });
      }
      patch.due_at = body.due_at || null;
    }
    for (const ref of ['assigned_to', 'contact_id', 'deal_id'] as const) {
      const value = body?.[ref];
      if (value === null) {
        patch[ref] = null;
      } else if (typeof value === 'string' && value) {
        patch[ref] = value;
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "nothing to update (action 'complete' or field edits)" },
        { status: 400 }
      );
    }
    if (patch.contact_id) {
      const { data } = await ctx.supabase
        .from('contacts').select('id').eq('id', patch.contact_id).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (patch.deal_id) {
      const { data } = await ctx.supabase
        .from('deals').select('id').eq('id', patch.deal_id).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    if (patch.assigned_to) {
      const { data } = await ctx.supabase
        .from('profiles').select('user_id').eq('user_id', patch.assigned_to).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, title, description, status, due_at, contact_id, assigned_to, deal_id, created_at, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ task: data });
  } catch (error) {
    if (error instanceof TaskWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/tasks/[id] — account-scoped delete (no event type
 * exists for deletion; mirrors deal delete).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
