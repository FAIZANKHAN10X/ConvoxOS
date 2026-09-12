import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { findFormByTokenHash, FormWriteError, hashFormToken, ingestSubmission } from '@/lib/forms/write';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Reject outsized submits before parsing (mirrors hooks route). */
export const MAX_FORM_BODY_BYTES = 64 * 1024;

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

/**
 * POST /api/forms/[token]/submit — public lead capture. The path
 * token identifies the form (SHA-256 lookup; unknown/inactive 404
 * alike). Values validate against the form schema, the contact is
 * upserted with dedupe (emitting contact_created/contact_updated),
 * and the submission is recorded with attribution. A client
 * `submission_key` collapses double-submits.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token || token.length < 16) return notFound();

    const limited = checkRateLimit(`forms:${token.slice(0, 12)}`, RATE_LIMITS.publicApi);
    if (!limited.success) return rateLimitResponse(limited);

    const rawBody = await request.text();
    if (rawBody.length > MAX_FORM_BODY_BYTES) {
      return NextResponse.json({ error: 'body too large' }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const form = await findFormByTokenHash(db, hashFormToken(token));
    if (!form || !form.is_active) return notFound();

    const { data: owner } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', form.account_id)
      .maybeSingle();
    const auditUserId = (owner as { owner_user_id: string } | null)?.owner_user_id;
    if (!auditUserId) {
      return NextResponse.json({ error: 'form unavailable' }, { status: 503 });
    }

    const values =
      body.values && typeof body.values === 'object' && !Array.isArray(body.values)
        ? (body.values as Record<string, unknown>)
        : {};
    const rawAttribution =
      body.attribution && typeof body.attribution === 'object' && !Array.isArray(body.attribution)
        ? (body.attribution as Record<string, unknown>)
        : {};
    const attribution: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'referrer']) {
      const v = rawAttribution[key];
      if (typeof v === 'string' && v.trim()) attribution[key] = v;
    }
    const submissionKey =
      typeof body.submission_key === 'string' && body.submission_key.length > 0 && body.submission_key.length <= 128
        ? body.submission_key
        : undefined;

    const result = await ingestSubmission(db, {
      accountId: form.account_id,
      auditUserId,
      form,
      values,
      attribution,
      submissionKey,
    });

    return NextResponse.json(
      {
        submission_id: (result.submission as { id: string }).id,
        contact_id: result.contactId,
        deduped: result.deduped,
      },
      { status: result.deduped ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof FormWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
