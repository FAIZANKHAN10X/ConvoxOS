import type { CatalogNode } from './catalog';
import { resolveCatalogPorts } from './ports';
import { fieldsFromJsonSchema } from './schema-fields';
import type { AutomationGraph, ValidationIssue } from './types';

export function validateDraftGraph(
  graph: AutomationGraph,
  catalog: CatalogNode[]
): ValidationIssue[] {
  const byType = new Map(catalog.map((n) => [n.type, n]));
  const issues: ValidationIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const triggerCount = graph.nodes.filter((n) => {
    const kind = byType.get(n.type)?.kind;
    return kind === 'trigger' || n.type.startsWith('trigger.');
  }).length;

  if (triggerCount === 0) {
    issues.push({ path: 'graph', message: 'Add a starting trigger' });
  } else if (triggerCount > 1) {
    issues.push({ path: 'graph', message: 'Only one trigger is allowed' });
  }

  for (const node of graph.nodes) {
    const def = byType.get(node.type);
    if (!def) {
      issues.push({
        path: `nodes.${node.id}`,
        message: `Unknown step "${node.type}"`,
      });
      continue;
    }
    const fields = fieldsFromJsonSchema(def.jsonSchema);
    for (const field of fields) {
      if (!field.required) continue;
      const value = node.data?.config?.[field.name];
      if (value === undefined || value === null || value === '') {
        issues.push({
          path: `nodes.${node.id}.config.${field.name}`,
          message: `${field.label} is required`,
        });
      }
    }
    const requireAllKind = def.kind === 'condition' || def.kind === 'trigger';
    const ports = resolveCatalogPorts(def, node.data?.config ?? {});
    const requireDynamic =
      def.dynamicPorts?.requireAll === true &&
      ports.outgoing.some((handle) => handle.dynamic === true);
    if ((requireAllKind || requireDynamic) && ports.outgoing.length > 0) {
      const outs = graph.edges.filter((e) => e.source === node.id);
      for (const handle of ports.outgoing) {
        const match = outs.some((edge) => {
          const id = edge.sourceHandle ?? 'default';
          if (handle.id === 'default') {
            return id === 'default' || id === 'next' || !edge.sourceHandle;
          }
          return id === handle.id;
        });
        const required =
          requireAllKind || (requireDynamic && handle.dynamic === true);
        if (required && !match) {
          issues.push({
            path: `nodes.${node.id}`,
            message: `Connect the ${handle.label} path`,
          });
        }
      }
    }
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        path: `edges.${edge.id}`,
        message: 'Broken connection',
      });
    }
  }

  return issues;
}

export function issuesByNode(issues: ValidationIssue[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const issue of issues) {
    const match = /^nodes\.([^.]*)/.exec(issue.path);
    const key = match?.[1] ?? '_graph';
    const list = map.get(key) ?? [];
    list.push(issue.message);
    map.set(key, list);
  }
  return map;
}
