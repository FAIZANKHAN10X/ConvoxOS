import { NextResponse } from 'next/server';

import { createEngineDeps, runAutomationWorker } from '@/lib/automation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export const maxDuration = 60;

function configuredSecret(): string | undefined {
  return (
    process.env.AUTOMATION_WORKER_SECRET ||
    process.env.AUTOMATION_CRON_SECRET ||
    process.env.CRON_SECRET
  );
}

function authorize(request: Request): boolean {
  const secret = configuredSecret();
  if (!secret) return false;
  const header = request.headers.get('authorization');
  if (header === `Bearer ${secret}`) return true;
  const cronHeader = request.headers.get('x-cron-secret');
  return cronHeader === secret;
}

async function handle(request: Request): Promise<NextResponse> {
  if (!configuredSecret()) {
    return NextResponse.json(
      { error: 'automation worker is not configured' },
      { status: 503 }
    );
  }
  if (!authorize(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit('automation-worker', RATE_LIMITS.publicApi);
  if (!limited.success) return rateLimitResponse(limited);

  const result = await runAutomationWorker(createEngineDeps());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
