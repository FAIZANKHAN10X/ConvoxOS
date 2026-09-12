import { NextResponse } from 'next/server';

import { findFormByTokenHash, hashFormToken } from '@/lib/forms/write';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

/**
 * GET /api/forms/[token] — public form peek for the render page.
 * Returns only the display schema (name + fields) of active forms;
 * unknown/inactive tokens 404 alike.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 16) return notFound();

  const limited = checkRateLimit(`forms-peek:${token.slice(0, 12)}`, RATE_LIMITS.publicApi);
  if (!limited.success) return rateLimitResponse(limited);

  const form = await findFormByTokenHash(
    supabaseAdmin(),
    hashFormToken(token)
  );
  if (!form || !form.is_active) return notFound();
  return NextResponse.json({ name: form.name, fields: form.fields });
}
