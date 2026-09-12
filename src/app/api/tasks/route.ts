import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createTask, TaskWriteError } from '@/lib/tasks/write';

/**
 * GET /api/tasks — account-scoped list with optional filters.
 * Reads go through the caller's RLS client; no events involved.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    let query = ctx.supabase
      .from('tasks')
      .select('id, title, description, status, due_at, contact_id, assigned_to, deal_id, created_at, updated_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);

    const status = url.searchParams.get('status');
    if (status === 'open' || status === 'completed') {
      query = query.eq('status', status);
    }
    const contactId = url.searchParams.get('contact_id');
    if (contactId) query = query.eq('contact_id', contactId);
    const dealId = url.searchParams.get('deal_id');
    if (dealId) query = query.eq('deal_id', dealId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/tasks — create via the domain writer so
 * `task_created` fires. Contact/deal/assignee references are
 * verified against the caller's account first.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      description?: unknown;
      contact_id?: unknown;
      deal_id?: unknown;
      assigned_to?: unknown;
      due_at?: unknown;
    } | null;

    const title = typeof body?.title === 'string' ? body.title : '';
    if (!title.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    const contactId =
      typeof body?.contact_id === 'string' && body.contact_id ? body.contact_id : null;
    const dealId =
      typeof body?.deal_id === 'string' && body.deal_id ? body.deal_id : null;
    const assignedTo =
      typeof body?.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null;
    const description =
      typeof body?.description === 'string' ? body.description : null;
    const dueAt = typeof body?.due_at === 'string' && body.due_at ? body.due_at : null;
    if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
      return NextResponse.json({ error: 'due_at must be a valid datetime' }, { status: 400 });
    }

    if (contactId) {
      const { data } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (dealId) {
      const { data } = await ctx.supabase
        .from('deals')
        .select('id')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    if (assignedTo) {
      // Tasks assign auth.users; accept a user id that belongs here.
      const { data } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', assignedTo)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    const task = await createTask(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      dealId,
      assignedTo,
      title: title.trim(),
      description: description?.trim() || null,
      dueAt,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
