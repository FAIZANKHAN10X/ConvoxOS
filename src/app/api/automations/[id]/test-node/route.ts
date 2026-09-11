import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { defaultRegistry } from '@/lib/automation';
import { NodeExecutionError } from '@/lib/automation/types';
import type { DomainEvent, ExecutionContext } from '@/lib/automation/types';

/**
 * Invoke one testable node with the current config, without publishing
 * or starting a run. Reuses the node's execute() + safe-fetch path.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    const { data: automation, error } = await ctx.supabase
      .from('automations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error || !automation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      nodeType?: unknown;
      nodeId?: unknown;
      config?: unknown;
    } | null;
    const nodeType = typeof body?.nodeType === 'string' ? body.nodeType : '';
    const def = defaultRegistry.get(nodeType);
    if (!def || !def.flags?.testable || !def.execute) {
      return NextResponse.json(
        { error: 'This step cannot be tested on its own' },
        { status: 400 }
      );
    }

    const parsed = def.configSchema.safeParse(body?.config ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid config' },
        { status: 400 }
      );
    }

    const now = new Date();
    const event: DomainEvent = {
      id: `test-event`,
      accountId: ctx.accountId,
      eventType: 'test',
      contactId: null,
      payload: {},
      source: 'crm',
      originRunId: null,
      causationEventId: null,
      chainDepth: 0,
      idempotencyKey: `test:${id}:${crypto.randomUUID()}`,
      status: 'pending',
      attempts: 0,
      availableAt: now.toISOString(),
      processedAt: null,
      lastError: null,
      createdAt: now.toISOString(),
    };
    const exec: ExecutionContext = {
      accountId: ctx.accountId,
      contactId: 'test-contact',
      runId: `test:${crypto.randomUUID()}`,
      nodeId:
        typeof body?.nodeId === 'string' && body.nodeId
          ? body.nodeId
          : 'test-node',
      automationId: id,
      versionId: 'draft',
      event,
      vars: { outputs: {} },
      now,
      db: ctx.supabase,
    };

    try {
      const result = await def.execute(exec, parsed.data);
      return NextResponse.json({ result });
    } catch (error) {
      if (error instanceof NodeExecutionError) {
        return NextResponse.json({
          result: {
            status: 'fail',
            error: error.message,
            retryable: error.retryable,
            output: error.details ?? null,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
