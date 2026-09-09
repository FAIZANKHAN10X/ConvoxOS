import type { NodeRegistry } from './registry';
import { extractTrigger, getNode, outgoingEdges, triggerNodes } from './graph';
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
    const outs = outgoingEdges(graph, node.id);
    if (def.kind === 'condition') {
      const handles = new Set(outs.map((e) => e.sourceHandle ?? 'default'));
      if (!handles.has('true') || !handles.has('false')) {
        issues.push({
          path: `nodes.${node.id}`,
          message: 'condition nodes need true and false branches',
        });
      }
    } else if (def.kind !== 'trigger' && outs.length > 1) {
      const unlabeled = outs.filter(
        (e) =>
          !e.sourceHandle ||
          e.sourceHandle === 'default' ||
          e.sourceHandle === 'next'
      );
      if (unlabeled.length > 1) {
        issues.push({
          path: `nodes.${node.id}`,
          message: 'linear nodes may only have one default outgoing edge',
        });
      }
    }
  }

  if (issues.length === 0 && !extractTrigger(graph)) {
    issues.push({ path: 'graph', message: 'could not extract trigger spec' });
  }

  return issues;
}
