import type { EngineDeps } from './engine';
import { executeRun } from './engine';
import type { DomainEvent } from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExternalWaitOutcome = 'resumed' | 'duplicate' | 'rejected' | 'none';

/**
 * Pull the outbound run id back out of an inbound webhook body.
 * n8n already sends `run_id`; `correlation_id` is the same value.
 */
export function extractRunCorrelation(
  event: DomainEvent
): string | null {
  const body =
    event.payload.body &&
    typeof event.payload.body === 'object' &&
    !Array.isArray(event.payload.body)
      ? (event.payload.body as Record<string, unknown>)
      : {};
  const candidates = [
    event.payload.run_id,
    event.payload.correlation_id,
    body.run_id,
    body.runId,
    body.correlation_id,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && UUID_RE.test(value)) return value;
  }
  return null;
}

function mergeCallbackContext(
  context: Record<string, unknown>,
  waitNodeId: string,
  body: unknown,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const priorOutputs =
    context.outputs &&
    typeof context.outputs === 'object' &&
    !Array.isArray(context.outputs)
      ? (context.outputs as Record<string, unknown>)
      : {};
  const priorNode =
    priorOutputs[waitNodeId] &&
    typeof priorOutputs[waitNodeId] === 'object' &&
    !Array.isArray(priorOutputs[waitNodeId])
      ? (priorOutputs[waitNodeId] as Record<string, unknown>)
      : {};
  const output = { ...priorNode, ...extra, body };
  return {
    ...context,
    lastOutput: output,
    callback: body,
    outputs: { ...priorOutputs, [waitNodeId]: output },
  };
}

/**
 * If this inbound event names a waiting run, claim that wait and
 * continue the same run. Otherwise leave the event for trigger matching.
 */
export async function resumeExternalWait(
  deps: EngineDeps,
  event: DomainEvent
): Promise<ExternalWaitOutcome> {
  if (event.eventType !== 'external.received') return 'none';
  const correlation = extractRunCorrelation(event);
  if (!correlation) return 'none';
  const automationId = event.payload.automation_id;
  if (typeof automationId !== 'string' || !automationId) return 'none';

  const existing = await deps.store.findEventWait({
    accountId: event.accountId,
    correlationKey: correlation,
  });
  if (!existing) return 'none';

  const existingRun = await deps.store.getRun(existing.runId);
  if (!existingRun || existingRun.automationId !== automationId) {
    return 'none';
  }
  if (
    event.contactId &&
    existingRun.contactId &&
    event.contactId !== existingRun.contactId
  ) {
    return 'rejected';
  }
  if (existing.status === 'claimed') return 'duplicate';
  if (existing.status !== 'pending') return 'none';

  const claimed = await deps.store.claimEventWait({
    accountId: event.accountId,
    correlationKey: correlation,
    automationId,
  });
  if (!claimed) return 'duplicate';

  const run = await deps.store.getRun(claimed.runId);
  if (!run || run.status === 'cancelled' || run.status === 'completed') {
    return 'duplicate';
  }

  const body = event.payload.body ?? {};
  const context = mergeCallbackContext(run.context, claimed.nodeId, body, {
    resumed: true,
    timedOut: false,
    eventId: event.id,
  });
  await deps.store.updateRun(run.id, {
    status: 'queued',
    currentNodeId: claimed.resumeNodeId ?? run.currentNodeId,
    waitUntil: null,
    context,
  });
  const succeeded = await deps.store.getSucceededStep(run.id, claimed.nodeId);
  if (succeeded) {
    await deps.store.updateStep(succeeded.id, {
      status: 'succeeded',
      output: {
        ...(succeeded.output ?? {}),
        resumed: true,
        body,
      },
    });
  }
  await executeRun(deps, run.id);
  return 'resumed';
}
