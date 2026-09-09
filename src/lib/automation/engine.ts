import {
  MAX_NODE_ATTEMPTS,
  MAX_NODE_EXECUTIONS_PER_INVOCATION,
  MAX_NODE_EXECUTIONS_PER_RUN,
} from './constants';
import { getNode, nextNodeId, nodeConfig, triggerNodes } from './graph';
import type { NodeRegistry } from './registry';
import { ActiveRunConflict, type AutomationStore } from './store';
import type {
  AutomationRun,
  DomainEvent,
  ExecutionContext,
  NodeResult,
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
  match: { automationId: string; versionId: string }
): Promise<AutomationRun | null> {
  const { store } = deps;
  if (!event.contactId) return null;

  const automation = await store.getAutomation(match.automationId);
  if (!automation || automation.status !== 'published') return null;
  if (automation.publishedVersionId !== match.versionId) {
    // New runs always use the currently published version. The match
    // payload already carries that id; this guards a race with disable.
    if (!automation.publishedVersionId) return null;
  }

  const versionId = automation.publishedVersionId ?? match.versionId;
  const version = await store.getVersion(versionId);
  if (!version) return null;

  const starts = triggerNodes(version.graph);
  const entry = starts[0]?.id ?? null;

  try {
    return await store.insertRun({
      accountId: event.accountId,
      automationId: automation.id,
      versionId: version.id,
      contactId: event.contactId,
      triggerEventId: event.id,
      currentNodeId: entry,
      context: { eventId: event.id, outputs: {} },
    });
  } catch (error) {
    if (error instanceof ActiveRunConflict) return error.existing;
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
  runId: string
): Promise<AutomationRun | null> {
  const { store, registry } = deps;
  const now = deps.now ?? (() => new Date());
  let run = await store.getRun(runId);
  if (!run) return null;

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

  run = await store.updateRun(runId, { status: 'running', waitUntil: null });

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
        await store.updateStep(step.id, { status: 'failed', error: message });

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
      if (!succeeded) {
        await store.insertWait({
          accountId: run.accountId,
          runId: run.id,
          nodeId: node.id,
          resumeNodeId,
          resumeAt: result.waitUntil,
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
