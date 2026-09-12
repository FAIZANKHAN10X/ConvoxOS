import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  AppointmentWriteError,
  setAppointmentStatus,
  updateAppointment,
  type AppointmentStatus,
} from '@/lib/appointments/write';

const STATUSES: AppointmentStatus[] = ['booked', 'confirmed', 'cancelled', 'completed'];

/**
 * PATCH /api/appointments/[id] — reschedule/rename via the generic
 * writer, or move status (`{ status }`). Status moves emit in T6.4;
 * field edits are silent.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: appointmentId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !(STATUSES as string[]).includes(body.status)) {
        return NextResponse.json(
          { error: 'status must be one of: booked, confirmed, cancelled, completed' },
          { status: 400 }
        );
      }
      const result = await setAppointmentStatus(ctx.supabase, {
        accountId: ctx.accountId,
        appointmentId,
        status: body.status as AppointmentStatus,
      });
      return NextResponse.json({
        appointment: result.appointment,
        changed: result.changed,
      });
    }

    if (
      ('title' in body && typeof body.title !== 'string') ||
      ('starts_at' in body && typeof body.starts_at !== 'string') ||
      ('ends_at' in body && body.ends_at !== null && typeof body.ends_at !== 'string') ||
      ('notes' in body && body.notes !== null && typeof body.notes !== 'string')
    ) {
      return NextResponse.json({ error: 'invalid fields' }, { status: 400 });
    }
    const patch: {
      title?: string;
      startsAt?: string;
      endsAt?: string | null;
      notes?: string | null;
    } = {};
    if ('title' in body) patch.title = body.title as string;
    if ('starts_at' in body) patch.startsAt = body.starts_at as string;
    if ('ends_at' in body) patch.endsAt = body.ends_at as string | null;
    if ('notes' in body) patch.notes = body.notes as string | null;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }
    const result = await updateAppointment(ctx.supabase, {
      accountId: ctx.accountId,
      appointmentId,
      patch,
    });
    return NextResponse.json({
      appointment: result.appointment,
      updated: result.changedFields,
    });
  } catch (error) {
    if (error instanceof AppointmentWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id: appointmentId } = await params;
    const { error } = await ctx.supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId)
      .eq('account_id', ctx.accountId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
