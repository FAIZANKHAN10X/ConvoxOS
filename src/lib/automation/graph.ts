import type {
  AutomationGraph,
  GraphEdge,
  GraphNode,
  TriggerSpec,
} from './types';

export function emptyGraph(): AutomationGraph {
  return { nodes: [], edges: [] };
}

/** Blank canvas for a new automation: one unconfigured starting trigger. */
export function starterGraph(): AutomationGraph {
  return {
    nodes: [
      {
        id: 'start',
        type: 'trigger.message_received',
        position: { x: 320, y: 48 },
        data: { config: {} },
      },
    ],
    edges: [],
  };
}

export function getNode(
  graph: AutomationGraph,
  id: string
): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function nodeConfig(node: GraphNode): Record<string, unknown> {
  return node.data?.config ?? {};
}

export function triggerNodes(graph: AutomationGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.type.startsWith('trigger.'));
}

export function extractTrigger(graph: AutomationGraph): TriggerSpec | null {
  const nodes = triggerNodes(graph);
  if (nodes.length !== 1) return null;
  const node = nodes[0];
  return { type: node.type, config: nodeConfig(node) };
}

/**
 * Follow the outgoing edge for a handle. `default` matches a missing
 * handle, `default`, or `next`. A single unlabeled edge is treated as
 * the default path so linear graphs stay simple.
 */
export function nextNodeId(
  graph: AutomationGraph,
  sourceId: string,
  handle = 'default'
): string | null {
  const edges = graph.edges.filter((e) => e.source === sourceId);
  if (edges.length === 0) return null;

  if (handle === 'default') {
    const labeled = edges.find(
      (e) =>
        !e.sourceHandle ||
        e.sourceHandle === 'default' ||
        e.sourceHandle === 'next'
    );
    if (labeled) return labeled.target;
    if (edges.length === 1) return edges[0].target;
    return null;
  }

  const match = edges.find((e) => e.sourceHandle === handle);
  return match ? match.target : null;
}

export function outgoingEdges(
  graph: AutomationGraph,
  sourceId: string
): GraphEdge[] {
  return graph.edges.filter((e) => e.source === sourceId);
}

export function graphFromNodes(
  nodes: Array<{
    id: string;
    type: string;
    config?: Record<string, unknown>;
    position?: { x: number; y: number };
  }>,
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
  }>
): AutomationGraph {
  return {
    nodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: i * 80 },
      data: { config: n.config ?? {} },
    })),
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: null,
    })),
  };
}
