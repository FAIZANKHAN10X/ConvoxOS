import { MAX_BLOCKS_WITHOUT_PAUSE } from './constants';
import {
  extractTrigger,
  getNode,
  nodeConfig,
  outgoingEdges,
  triggerNodes,
} from './graph';
import { dynamicHandles, resolveDefPorts } from './ports';
import type { NodeRegistry } from './registry';
import type {
  AutomationGraph,
  NodeDefinition,
  ValidationIssue,
} from './types';

export function validateGraph(
  graph: AutomationGraph,
  registry: NodeRegistry
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const parsedById = new Map<string, Record<string, unknown>>();

  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    issues.push({ path: 'graph', message: 'nodes and edges arrays required' });
    return issues;
  }

  for (const node of graph.nodes) {
    if (!node.id) {
      issues.push({ path: 'nodes', message: 'every node needs an id' });
      continue;
    }
    if (ids.has(node.id)) {
      issues.push({ path: `nodes.${node.id}`, message: 'duplicate node id' });
    }
    ids.add(node.id);

    const def = registry.get(node.type);
    if (!def) {
      issues.push({
        path: `nodes.${node.id}`,
        message: `unknown node type "${node.type}"`,
      });
      continue;
    }

    const parsed = def.configSchema.safeParse(node.data?.config ?? {});
    if (!parsed.success) {
      for (const err of parsed.error.issues) {
        issues.push({
          path: `nodes.${node.id}.config.${err.path.join('.')}`,
          message: err.message,
        });
      }
      continue;
    }

    if (def.validate) {
      for (const message of def.validate(parsed.data, graph)) {
        issues.push({ path: `nodes.${node.id}`, message });
      }
    }

    const config = parsed.data as Record<string, unknown>;
    parsedById.set(node.id, config);
    validateBlocks(node.id, def, config, issues);
    validateTasks(node.id, def, config, issues);
  }

  const starts = triggerNodes(graph);
  if (starts.length === 0) {
    issues.push({
      path: 'graph',
      message: 'exactly one trigger node is required',
    });
  } else if (starts.length > 1) {
    issues.push({ path: 'graph', message: 'only one trigger node is allowed' });
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) {
      issues.push({
        path: `edges.${edge.id}`,
        message: `source "${edge.source}" does not exist`,
      });
    }
    if (!ids.has(edge.target)) {
      issues.push({
        path: `edges.${edge.id}`,
        message: `target "${edge.target}" does not exist`,
      });
    }
    const target = getNode(graph, edge.target);
    if (target?.type.startsWith('trigger.')) {
      issues.push({
        path: `edges.${edge.id}`,
        message: 'trigger nodes cannot have incoming edges',
      });
    }
  }

  for (const node of graph.nodes) {
    const def = registry.get(node.type);
    if (!def) continue;
    const ports = resolveDefPorts(def, parsedById.get(node.id));
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    if (!ports.incoming && incoming.length > 0) {
      issues.push({
        path: `nodes.${node.id}`,
        message: 'this step cannot have incoming connections',
      });
    }
    const outs = outgoingEdges(graph, node.id);
    const knownIds = new Set(ports.outgoing.map((handle) => handle.id));
    for (const edge of outs) {
      const id = edge.sourceHandle ?? 'default';
      const known =
        knownIds.has(id) ||
        (id === 'next' && knownIds.has('default'));
      if (!known) {
        issues.push({
          path: `edges.${edge.id}`,
          message: `unknown output "${edge.sourceHandle}" for ${node.type}`,
        });
      }
    }
    const requireAllKind = def.kind === 'condition' || def.kind === 'trigger';
    // Rule-driven requireAll applies to generated (button/variant)
    // handles only — the default Next continuation stays optional so
    // messages may terminate a path, as in ManyChat.
    const requireDynamic =
      def.dynamicPorts?.requireAll === true &&
      dynamicHandles(def.dynamicPorts, parsedById.get(node.id) ?? {}) !==
        null;
    for (const handle of ports.outgoing) {
      const match = outs.filter((edge) => {
        const id = edge.sourceHandle ?? 'default';
        if (handle.id === 'default') {
          return id === 'default' || id === 'next' || !edge.sourceHandle;
        }
        return id === handle.id;
      });
      const required = requireAllKind || (requireDynamic && handle.dynamic === true);
      if (required && match.length === 0) {
        issues.push({
          path: `nodes.${node.id}`,
          message: `connect the ${handle.label} path`,
        });
      }
      if (match.length > 1) {
        issues.push({
          path: `nodes.${node.id}`,
          message: `${handle.label} may only have one outgoing connection`,
        });
      }
    }
  }

  if (issues.length === 0 && !extractTrigger(graph)) {
    issues.push({ path: 'graph', message: 'could not extract trigger spec' });
  }

  const longest = longestUnpausedChain(graph, registry);
  if (longest > MAX_BLOCKS_WITHOUT_PAUSE) {
    issues.push({
      path: 'graph',
      message: `more than ${MAX_BLOCKS_WITHOUT_PAUSE} steps without a pause: insert a delay or input-waiting step`,
    });
  }

  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A node breaks a no-pause run when it suspends execution (waits),
 * declares itself pausing, or — for containers — holds a pausing
 * block type (a message with buttons pauses; text-only does not).
 * Config-aware so containers are judged by content, not by kind.
 */
export function nodePausesFlow(
  def: Pick<NodeDefinition, 'kind' | 'flags' | 'blockField'>,
  config?: Record<string, unknown>
): boolean {
  if (def.flags?.pausesFlow === true || def.kind === 'wait') return true;
  const pausing = def.flags?.pausesFlowBlocks;
  if (pausing && pausing.length > 0 && config) {
    const raw = config[def.blockField ?? 'blocks'];
    if (Array.isArray(raw)) {
      return raw.some(
        (item) =>
          !!item &&
          typeof item === 'object' &&
          pausing.includes(
            String((item as Record<string, unknown>).blockType ?? '')
          )
      );
    }
  }
  return false;
}

/**
 * Longest chain of consecutive non-pausing nodes following any path
 * from a trigger. Cycles terminate the walk (loop detection is the
 * engine budgets' job, not this counter's).
 */
export function longestUnpausedChain(
  graph: AutomationGraph,
  registry: NodeRegistry
): number {
  let max = 0;
  const visit = (
    nodeId: string,
    streak: number,
    path: Set<string>
  ): void => {
    if (path.has(nodeId)) {
      max = Math.max(max, streak);
      return;
    }
    const node = getNode(graph, nodeId);
    if (!node) {
      max = Math.max(max, streak);
      return;
    }
    const def = registry.get(node.type);
    const next = new Set(path);
    next.add(nodeId);
    if (def?.kind === 'trigger') {
      // The Starting Step opens a run; it is not a content block and
      // neither extends nor resets the no-pause streak.
      max = Math.max(max, streak);
    } else if (!def || nodePausesFlow(def, nodeConfig(node))) {
      max = Math.max(max, streak);
      streak = 0;
    } else {
      streak += 1;
      max = Math.max(max, streak);
    }
    for (const edge of outgoingEdges(graph, nodeId)) {
      visit(edge.target, streak, next);
    }
  };
  for (const start of triggerNodes(graph)) {
    visit(start.id, 0, new Set());
  }
  return max;
}

function validateBlocks(
  nodeId: string,
  def: Pick<NodeDefinition, 'blocks' | 'blockField'>,
  config: Record<string, unknown>,
  issues: ValidationIssue[]
): void {
  const field = def.blockField ?? 'blocks';
  const raw = config[field];
  if (raw === undefined) return;
  const path = `nodes.${nodeId}.config.${field}`;
  if (!def.blocks) {
    issues.push({ path, message: 'this step does not support content blocks' });
    return;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: 'blocks must be a list' });
    return;
  }
  const byType = new Map(def.blocks.map((block) => [block.blockType, block]));
  const seenIds = new Set<string>();
  raw.forEach((item, index) => {
    const base = `${path}.${index}`;
    if (!isRecord(item)) {
      issues.push({ path: base, message: 'block must be an object' });
      return;
    }
    if (typeof item.id !== 'string' || !item.id) {
      issues.push({ path: `${base}.id`, message: 'every block needs an id' });
    } else {
      if (seenIds.has(item.id)) {
        issues.push({
          path: `${base}.id`,
          message: `duplicate block id "${item.id}"`,
        });
      }
      seenIds.add(item.id);
    }
    const block =
      typeof item.blockType === 'string'
        ? byType.get(item.blockType)
        : undefined;
    if (!block) {
      issues.push({
        path: `${base}.blockType`,
        message: `unknown block "${String(item.blockType)}"`,
      });
      return;
    }
    const blockConfig = item.config ?? {};
    if (!isRecord(blockConfig)) {
      issues.push({
        path: `${base}.config`,
        message: 'block config must be an object',
      });
      return;
    }
    const parsed = block.configSchema.safeParse(blockConfig);
    if (!parsed.success) {
      for (const err of parsed.error.issues) {
        issues.push({
          path: `${base}.config.${err.path.join('.')}`,
          message: err.message,
        });
      }
    }
  });
}

function validateTasks(
  nodeId: string,
  def: Pick<NodeDefinition, 'tasks' | 'taskField'>,
  config: Record<string, unknown>,
  issues: ValidationIssue[]
): void {
  const field = def.taskField ?? 'tasks';
  const raw = config[field];
  if (raw === undefined) return;
  const path = `nodes.${nodeId}.config.${field}`;
  if (!def.tasks) {
    issues.push({ path, message: 'this step does not support task lists' });
    return;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: 'tasks must be a list' });
    return;
  }
  const byType = new Map(def.tasks.map((task) => [task.taskType, task]));
  raw.forEach((item, index) => {
    const base = `${path}.${index}`;
    if (!isRecord(item)) {
      issues.push({ path: base, message: 'task must be an object' });
      return;
    }
    if (typeof item.id !== 'string' || !item.id) {
      issues.push({ path: `${base}.id`, message: 'every task needs an id' });
    }
    const handler =
      typeof item.taskType === 'string'
        ? byType.get(item.taskType)
        : undefined;
    if (!handler) {
      issues.push({
        path: `${base}.taskType`,
        message: `unknown task "${String(item.taskType)}"`,
      });
      return;
    }
    const taskConfig = item.config ?? {};
    if (!isRecord(taskConfig)) {
      issues.push({
        path: `${base}.config`,
        message: 'task config must be an object',
      });
      return;
    }
    const parsed = handler.configSchema.safeParse(taskConfig);
    if (!parsed.success) {
      for (const err of parsed.error.issues) {
        issues.push({
          path: `${base}.config.${err.path.join('.')}`,
          message: err.message,
        });
      }
    }
  });
}
