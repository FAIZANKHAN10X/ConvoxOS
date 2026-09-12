import {
  MAX_NODE_ATTEMPTS,
  MAX_NODE_EXECUTIONS_PER_INVOCATION,
  MAX_NODE_EXECUTIONS_PER_RUN,
} from './constants';
import { evaluateEnrollment } from './enroll';
import { getNode, nextNodeId, nodeConfig, triggerNodes } from './graph';
import type { NodeRegistry } from './registry';
import { ActiveRunConflict, type AutomationStore } from './store';
import type {
  AutomationRun,
  AutomationVersion,
  DomainEvent,
  ExecutionContext,
  NodeResult,
  ReentryPolicy,
} from './types';
import { NodeExecutionError } from './types';

export interface EngineDeps {
  store: AutomationStore;
  registry: NodeRegistry;
  db: unknown;
  now?: () => Date;
}

function backoffMs(attempt: number): number {
  return 1000 * 4 ** Math.max(attempt - 1, 0);
}

export async function createRunFromMatch(
  deps: EngineDeps,
  event: DomainEvent,
  match: {
    automationId: string;
    versionId: string;
    version?: AutomationVersion;
    reentryPolicy?: ReentryPolicy;
    /** T5.5: the matched trigger node — the run starts here. */
    entryNodeId?: string;
  }
): Promise<AutomationRun | null> {
  const { store } = deps;
  if (!event.contactId) return null;

  // Resolve the version first (no side effects), then run the single
  // T5.4 enrollment gate with the freshest policy: the re-read
  // automation row when available, else the carried trigger policy
  // (same freshness guarantee as the carried version — T1.4).
  let automationId = match.automationId;
  let version: AutomationVersion | null = null;
  let reentryPolicy: ReentryPolicy = match.reentryPolicy ?? 'repeat';

  // T1.4: prefer the version carried with the trigger (read in the
  // same list query this tick) over re-reading automation + version.
  // The list only selects published rows, so the status guarantee is
  // the list query's, not a second read's. Callers without a carried
  // version fall back to the re-read path (tests, older callers).
  if (match.version && match.version.id === match.versionId) {
    version = match.version;
  } else {
    const automation = await store.getAutomation(match.automationId);
    if (!automation || automation.status !== 'published') return null;
    if (automation.publishedVersionId !== match.versionId) {
      // New runs always use the currently published version. The match
      // payload already carries that id; this guards a race with disable.
      if (!automation.publishedVersionId) return null;
    }
    reentryPolicy = automation.reentryPolicy;
    automationId = automation.id;
    const versionId = automation.publishedVersionId ?? match.versionId;
    version = await store.getVersion(versionId);
    if (!version) return null;
  }

  // T5.4 enrollment gate: deterministic skip (recorded) instead of
  // blind insert. The unique index remains the race backstop below.
  const contactId = event.contactId;
  const activeRun = await store.findActiveRun(automationId, contactId);
  const priorRun =
    !activeRun && reentryPolicy === 'once'
      ? await store.hasAnyRun(automationId, contactId)
      : false;
  const verdict = evaluateEnrollment({ reentryPolicy, activeRun, priorRun });
  if (verdict.decision === 'skip') {
    await store.recordEnrollmentSkip({
      accountId: event.accountId,
      automationId,
      contactId,
      eventId: event.id,
      reason: verdict.reason,
      existingRunId: verdict.existingRunId,
    });
    return null;
  }

  const starts = triggerNodes(version.graph);
  // T5.5: start at the matched trigger; fall back to the first
  // trigger for callers that predate multi-trigger (tests, older
  // paths that match on the denormalized version trigger).
  const entry =
    (match.entryNodeId && starts.some((n) => n.id === match.entryNodeId)
      ? match.entryNodeId
      : null) ?? starts[0]?.id ?? null;

  try {
    return await store.insertRun({
      accountId: event.accountId,
      automationId,
      versionId: version.id,
      contactId,
      triggerEventId: event.id,
      currentNodeId: entry,
      context: {
        eventId: event.id,
        outputs: {},
        enrollment: {
          reentryPolicy,
          decision: 'enrolled',
          triggerNodeId: entry,
        },
      },
    });
  } catch (error) {
    if (error instanceof ActiveRunConflict) {
      // Lost the insert race after the gate read: record the same
      // deterministic outcome as a gate skip. The winner owns the
      // run (claimDueRuns executes it) — return null so this tick
      // neither double-counts nor double-executes.
      await store.recordEnrollmentSkip({
        accountId: event.accountId,
        automationId,
        contactId,
        eventId: event.id,
        reason: 'active_run',
        existingRunId: error.existing.id,
      });
      return null;
    }
    throw error;
  }
}

export async function cancelRun(
  store: AutomationStore,
  runId: string
): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) return;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    return;
  }
  await store.cancelWaitsForRun(runId);
  await store.updateRun(runId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  });
}

export async function executeRun(
  deps: EngineDeps,
  runId: string,
  opts: { skipClaim?: boolean } = {}
): Promise<AutomationRun | null> {
  const { store, registry } = deps;
  const now = deps.now ?? (() => new Date());
  let run: AutomationRun | null;
  if (opts.skipClaim) {
    // Caller already holds the claim (claimDueRuns SKIP LOCKED in the
    // same tick). Re-read for fresh state but do not CAS.
    run = await store.getRun(runId);
    if (!run) return null;
  } else {
    // Mutual exclusion: exactly one worker wins the queued/waiting →
    // running transition. Losers return the current row untouched so a
    // kick racing the cron can never double-execute a run.
    run = await store.claimRunForExecution(runId, now());
    if (!run) {
      return store.getRun(runId);
    }
  }

  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    return run;
  }

  const version = await store.getVersion(run.versionId);
  if (!version) {
    return store.updateRun(runId, {
      status: 'failed',
      lastError: 'pinned version missing',
      completedAt: now().toISOString(),
    });
  }

  const event = run.triggerEventId
    ? await store.getEvent(run.triggerEventId)
    : null;
  if (!event) {
    return store.updateRun(runId, {
      status: 'failed',
      lastError: 'trigger event missing',
      completedAt: now().toISOString(),
    });
  }

  // Claim paths above already hold `running` with `waitUntil` cleared
  // (CAS here, SKIP LOCKED RPC for skipClaim) — no extra transition.

  const graph = version.graph;
  let current = run.currentNodeId;
  if (!current) {
    current = triggerNodes(graph)[0]?.id ?? null;
  }

  let invocations = 0;
  let nodeExecutions = run.nodeExecutions;
  let contextVars: Record<string, unknown> = { ...run.context };

  while (current && invocations < MAX_NODE_EXECUTIONS_PER_INVOCATION) {
    if (nodeExecutions >= MAX_NODE_EXECUTIONS_PER_RUN) {
      return store.updateRun(runId, {
        status: 'failed',
        lastError: 'run exceeded 200 node executions',
        nodeExecutions,
        currentNodeId: current,
        completedAt: now().toISOString(),
      });
    }

    const node = getNode(graph, current);
    if (!node) {
      return store.updateRun(runId, {
        status: 'failed',
        lastError: `unknown node "${current}"`,
        nodeExecutions,
        completedAt: now().toISOString(),
      });
    }

    let def;
    try {
      def = registry.require(node.type);
    } catch (error) {
      return store.updateRun(runId, {
        status: 'failed',
        lastError: error instanceof Error ? error.message : 'unknown node type',
        nodeExecutions,
        completedAt: now().toISOString(),
      });
    }

    if (def.kind === 'trigger') {
      current = nextNodeId(graph, node.id, 'default');
      continue;
    }

    const parsed = def.configSchema.safeParse(nodeConfig(node));
    if (!parsed.success) {
      return store.updateRun(runId, {
        status: 'failed',
        lastError: `invalid config for ${node.type}`,
        nodeExecutions,
        currentNodeId: current,
        completedAt: now().toISOString(),
      });
    }

    const ctx: ExecutionContext = {
      accountId: run.accountId,
      contactId: run.contactId,
      runId: run.id,
      nodeId: node.id,
      automationId: run.automationId,
      versionId: run.versionId,
      event,
      vars: contextVars,
      now: now(),
      db: deps.db,
    };

    const succeeded = await store.getSucceededStep(run.id, node.id);
    let result: NodeResult;
    let attempt = 1;

    if (succeeded?.output) {
      result = {
        status: 'ok',
        output: succeeded.output,
      };
      if (succeeded.output.__result === 'wait' && succeeded.output.waitUntil) {
        result = {
          status: 'wait',
          waitUntil: String(succeeded.output.waitUntil),
        };
      }
      if (succeeded.output.__result === 'branch' && succeeded.output.branch) {
        result = { status: 'branch', branch: String(succeeded.output.branch) };
      }
    } else {
      const priorSteps = await store.listSteps(run.id);
      const priorAttempts = priorSteps.filter((s) => s.nodeId === node.id);
      attempt = priorAttempts.length + 1;
      const step = await store.insertStep({
        accountId: run.accountId,
        runId: run.id,
        nodeId: node.id,
        nodeType: node.type,
        attempt,
        idempotencyKey: `${run.id}:${node.id}:${attempt}`,
        input: parsed.data as Record<string, unknown>,
      });

      try {
        if (!def.execute) {
          throw new NodeExecutionError(
            `node type ${def.type} has no executor`,
            false
          );
        }
        result = await def.execute(ctx, parsed.data);
        const output: Record<string, unknown> = {
          ...(result.status === 'fail' ? {} : result.output),
        };
        if (result.status === 'wait') {
          output.__result = 'wait';
          output.waitUntil = result.waitUntil;
        }
        if (result.status === 'branch') {
          output.__result = 'branch';
          output.branch = result.branch;
        }
        if (result.status === 'fail') {
          await store.updateStep(step.id, {
            status: 'failed',
            error: result.error,
          });
        } else {
          await store.updateStep(step.id, {
            status: 'succeeded',
            output,
          });
        }
      } catch (error) {
        const retryable =
          error instanceof NodeExecutionError ? error.retryable : true;
        const message =
          error instanceof Error ? error.message : 'node execution failed';
        await store.updateStep(step.id, {
          status: 'failed',
          error: message,
          output:
            error instanceof NodeExecutionError ? error.details ?? null : null,
        });

        if (retryable && attempt < MAX_NODE_ATTEMPTS) {
          return store.updateRun(runId, {
            status: 'queued',
            currentNodeId: current,
            nodeExecutions,
            attempt: attempt + 1,
            lastError: message,
            waitUntil: new Date(
              now().getTime() + backoffMs(attempt)
            ).toISOString(),
            context: contextVars,
          });
        }

        return store.updateRun(runId, {
          status: 'failed',
          lastError: message,
          nodeExecutions,
          currentNodeId: current,
          completedAt: now().toISOString(),
        });
      }
    }

    nodeExecutions += 1;
    invocations += 1;

    if (result.status === 'fail') {
      const retryable = result.retryable ?? false;
      if (retryable && attempt < MAX_NODE_ATTEMPTS) {
        return store.updateRun(runId, {
          status: 'queued',
          currentNodeId: current,
          nodeExecutions,
          lastError: result.error,
          waitUntil: new Date(
            now().getTime() + backoffMs(attempt)
          ).toISOString(),
          context: contextVars,
        });
      }
      return store.updateRun(runId, {
        status: 'failed',
        lastError: result.error,
        nodeExecutions,
        currentNodeId: current,
        completedAt: now().toISOString(),
      });
    }

    if (result.status === 'end') {
      return store.updateRun(runId, {
        status: 'completed',
        nodeExecutions,
        currentNodeId: current,
        completedAt: now().toISOString(),
        context: contextVars,
      });
    }

    if (result.status === 'wait') {
      const resumeNodeId = nextNodeId(graph, node.id, 'default');
      const waitKind = result.waitKind === 'event' ? 'event' : 'time';
      if (result.output) {
        const priorOutputs =
          contextVars.outputs &&
          typeof contextVars.outputs === 'object' &&
          !Array.isArray(contextVars.outputs)
            ? (contextVars.outputs as Record<string, unknown>)
            : {};
        contextVars = {
          ...contextVars,
          lastOutput: result.output,
          outputs: { ...priorOutputs, [node.id]: result.output },
        };
      }
      if (!succeeded) {
        await store.insertWait({
          accountId: run.accountId,
          runId: run.id,
          nodeId: node.id,
          resumeNodeId,
          resumeAt: result.waitUntil,
          kind: waitKind,
          correlationKey: waitKind === 'event' ? run.id : null,
        });
      }
      return store.updateRun(runId, {
        status: 'waiting',
        currentNodeId: resumeNodeId,
        nodeExecutions,
        waitUntil: result.waitUntil,
        context: contextVars,
      });
    }

    if (result.output) {
      const priorOutputs =
        contextVars.outputs &&
        typeof contextVars.outputs === 'object' &&
        !Array.isArray(contextVars.outputs)
          ? (contextVars.outputs as Record<string, unknown>)
          : {};
      contextVars = {
        ...contextVars,
        lastOutput: result.output,
        outputs: { ...priorOutputs, [node.id]: result.output },
      };
    }

    const handle = result.status === 'branch' ? result.branch : 'default';
    current = nextNodeId(graph, node.id, handle);

    await store.updateRun(runId, {
      currentNodeId: current,
      nodeExecutions,
      context: contextVars,
      status: 'running',
    });
  }

  if (!current) {
    return store.updateRun(runId, {
      status: 'completed',
      nodeExecutions,
      currentNodeId: null,
      completedAt: now().toISOString(),
      context: contextVars,
    });
  }

  // Invocation budget exhausted; continue on the next worker tick.
  return store.updateRun(runId, {
    status: 'queued',
    currentNodeId: current,
    nodeExecutions,
    waitUntil: now().toISOString(),
    context: contextVars,
  });
}
