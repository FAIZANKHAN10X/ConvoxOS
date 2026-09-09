import { extractTrigger, getNode, outgoingEdges, triggerNodes } from './graph';
import { resolvePorts } from './ports';
import type { NodeRegistry } from './registry';
import type { AutomationGraph, ValidationIssue } from './types';

export function validateGraph(
  graph: AutomationGraph,
  registry: NodeRegistry
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

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
    const ports = resolvePorts(def);
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    if (!ports.incoming && incoming.length > 0) {
      issues.push({
        path: `nodes.${node.id}`,
        message: 'this step cannot have incoming connections',
      });
    }
    const outs = outgoingEdges(graph, node.id);
    const requireAll = def.kind === 'condition' || def.kind === 'trigger';
    for (const handle of ports.outgoing) {
      const match = outs.filter((edge) => {
        const id = edge.sourceHandle ?? 'default';
        if (handle.id === 'default') {
          return id === 'default' || id === 'next' || !edge.sourceHandle;
        }
        return id === handle.id;
      });
      if (requireAll && match.length === 0) {
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

  return issues;
}
