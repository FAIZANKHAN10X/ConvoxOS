import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitAppointmentStatusChanged } from '@/lib/automation/crm-events';
import {
  AppointmentWriteError,
  createAppointment,
} from '@/lib/appointments/write';

/**
 * GET /api/appointments — upcoming-first bounded list with contact
 * embedded. POST — book an appointment (status starts `booked`;
 * T6.4 emits the booked event here).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1),
      200
    );
    const { data, error } = await ctx.supabase
      .from('appointments')
      .select(
        'id, title, starts_at, ends_at, status, notes, created_at, contact:contacts(id, name, phone)'
      )
      .eq('account_id', ctx.accountId)
      .order('starts_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({ appointments: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }
    if (typeof body.title !== 'string' || typeof body.contact_id !== 'string') {
      return NextResponse.json(
        { error: "'title' and 'contact_id' are required" },
        { status: 400 }
      );
    }
    const appointment = await createAppointment(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId: body.contact_id,
      title: body.title,
      startsAt: body.starts_at as string,
      endsAt: (body.ends_at as string | null | undefined) ?? null,
      notes: (body.notes as string | null | undefined) ?? null,
    });
    // T6.4: booking enters automation like every status move.
    await emitAppointmentStatusChanged({
      db: ctx.supabase,
      accountId: ctx.accountId,
      contactId: appointment.contact_id,
      appointmentId: appointment.id,
      payload: {
        appointment_id: appointment.id,
        from_status: null,
        to_status: appointment.status,
        source: 'manual',
      },
      idempotencyKey: `appointment_status_changed:${appointment.id}:booked`,
      source: 'crm',
    });
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
