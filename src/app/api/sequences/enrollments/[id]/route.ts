import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  cancelSequenceEnrollment,
  pauseSequenceEnrollment,
  resumeSequenceEnrollment,
} from '@/lib/sequences/engine';

/**
 * PATCH /api/sequences/enrollments/[id] — pause, resume, or cancel
 * one enrollment. T4.3 management UI calls this; transitions are
 * validated here (active<->paused, anything-terminal→cancelled
 * except completed) and enforced again in the engine guards.
 * Session-authed (dashboard users); account ownership enforced
 * on every write via ctx.accountId.
 */
const ACTIONS = ['pause', 'resume', 'cancel'] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: enrollmentId } = await params;
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    const action = body?.action as Action | undefined;
    if (!action || !(ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: 'action must be one of: pause, resume, cancel' },
        { status: 400 }
      );
    }

    let changed = false;
    if (action === 'pause') {
      changed = await pauseSequenceEnrollment(enrollmentId, ctx.accountId);
    } else if (action === 'resume') {
      changed = await resumeSequenceEnrollment(enrollmentId, ctx.accountId);
    } else {
      changed = await cancelSequenceEnrollment(enrollmentId, ctx.accountId, 'manual');
    }
    if (!changed) {
      return NextResponse.json(
        { error: 'enrollment not found or transition not allowed' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return toErrorResponse(error);
  }
}
