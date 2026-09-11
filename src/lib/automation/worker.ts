import {
  CALLBACK_DEFERRAL_MS,
  MAX_CALLBACK_DEFERRALS,
  MAX_EVENT_CHAIN_DEPTH,
} from './constants';
import { createRunFromMatch, executeRun, type EngineDeps } from './engine';
import { resumeExternalWait } from './external-wait';
import { matchTriggers } from './match';
// NOTE: no `import './nodes'` here. Node registration lives in
// `nodes/index.ts` (pulled in via `@/lib/automation` in production
// and directly by tests). Importing the barrel from the worker
// closes an import cycle (node → tasks/write → crm-events → kick →
// worker → nodes) that leaves registry entries undefined.
import type { DomainEvent } from './types';

export interface WorkerResult {
  eventsProcessed: number;
  runsCreated: number;
  runsExecuted: number;
  waitsResumed: number;
}

export async function processDomainEvent(
  deps: EngineDeps,
  eventId: string
): Promise<WorkerResult> {
  const event = await deps.store.getEvent(eventId);
  if (!event) {
    return {
      eventsProcessed: 0,
      runsCreated: 0,
      runsExecuted: 0,
      waitsResumed: 0,
    };
  }
  if (
    event.status === 'processed' ||
    event.status === 'skipped' ||
    event.status === 'failed'
  ) {
    return {
      eventsProcessed: 0,
      runsCreated: 0,
      runsExecuted: 0,
      waitsResumed: 0,
    };
  }
  const first = await processClaimedEvent(deps, event);
  const extra = await runAutomationWorker(deps);
  return {
    eventsProcessed: first.eventsProcessed + extra.eventsProcessed,
    runsCreated: first.runsCreated + extra.runsCreated,
    runsExecuted: first.runsExecuted + extra.runsExecuted,
    waitsResumed: first.waitsResumed + extra.waitsResumed,
  };
}

export async function processClaimedEvent(
  deps: EngineDeps,
  event: DomainEvent
): Promise<WorkerResult> {
  const result: WorkerResult = {
    eventsProcessed: 1,
    runsCreated: 0,
    runsExecuted: 0,
    waitsResumed: 0,
  };

  if (event.chainDepth >= MAX_EVENT_CHAIN_DEPTH) {
    await deps.store.markEvent(event.id, 'skipped', 'max_event_chain_depth');
    return result;
  }

  try {
    const continuation = await resumeExternalWait(deps, event);
    if (continuation === 'resumed') {
      result.waitsResumed += 1;
      result.runsExecuted += 1;
      await deps.store.markEvent(event.id, 'processed');
      return result;
    }
    if (continuation === 'duplicate' || continuation === 'rejected') {
      await deps.store.markEvent(event.id, 'processed');
      return result;
    }
    if (continuation === 'deferred') {
      // The callback names a live run whose wait row has not committed
      // yet (fast-callback race). Requeue briefly so the wait can land;
      // after enough attempts the flow is genuinely broken, so fall
      // through to normal matching and surface it visibly.
      if (event.attempts < MAX_CALLBACK_DEFERRALS) {
        const now = deps.now?.() ?? new Date();
        await deps.store.deferEvent(
          event.id,
          new Date(now.getTime() + CALLBACK_DEFERRAL_MS)
        );
        return result;
      }
    }

    const matches = await matchTriggers(deps.store, deps.registry, event);
    for (const match of matches) {
      const run = await createRunFromMatch(deps, event, {
        automationId: match.trigger.automationId,
        versionId: match.trigger.versionId,
      });
      if (!run) continue;
      result.runsCreated += 1;
      if (run.status === 'queued' || run.status === 'running') {
        await executeRun(deps, run.id);
        result.runsExecuted += 1;
      }
    }
    await deps.store.markEvent(event.id, 'processed');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'event processing failed';
    await deps.store.markEvent(event.id, 'failed', message);
  }

  return result;
}

export async function runAutomationWorker(
  deps: EngineDeps,
  opts: { limit?: number } = {}
): Promise<WorkerResult> {
  const now = deps.now?.() ?? new Date();
  const limit = opts.limit ?? 20;
  const totals: WorkerResult = {
    eventsProcessed: 0,
    runsCreated: 0,
    runsExecuted: 0,
    waitsResumed: 0,
  };

  const events = await deps.store.claimPendingEvents(limit, now);
  for (const event of events) {
    const part = await processClaimedEvent(deps, event);
    totals.eventsProcessed += part.eventsProcessed;
    totals.runsCreated += part.runsCreated;
    totals.runsExecuted += part.runsExecuted;
  }

  const waits = await deps.store.claimDueWaits(limit, now);
  for (const wait of waits) {
    const run = await deps.store.getRun(wait.runId);
    if (!run || run.status === 'cancelled' || run.status === 'completed') {
      // The wait was already claimed above — release it so it does not
      // orphan in `claimed` forever (nothing reaps claimed time waits).
      await deps.store.cancelWaitsForRun(wait.runId);
      continue;
    }
    if (wait.resumeNodeId) {
      const context =
        wait.kind === 'event'
          ? {
              ...run.context,
              lastOutput: {
                ...((run.context.lastOutput as Record<string, unknown>) ?? {}),
                resumed: false,
                timedOut: true,
              },
            }
          : run.context;
      await deps.store.updateRun(run.id, {
        status: 'queued',
        currentNodeId: wait.resumeNodeId,
        waitUntil: null,
        context,
      });
    }
    await executeRun(deps, run.id);
    totals.waitsResumed += 1;
    totals.runsExecuted += 1;
  }

  const dueRuns = await deps.store.claimDueRuns(limit, now);
  for (const run of dueRuns) {
    // Already atomically claimed (queued→running) by the RPC above —
    // execute without re-claiming.
    await executeRun(deps, run.id, { skipClaim: true });
    totals.runsExecuted += 1;
  }

  return totals;
}
