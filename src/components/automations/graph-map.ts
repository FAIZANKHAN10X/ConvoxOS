import type { Edge, Node } from '@xyflow/react';

import type { AutomationGraph } from '@/lib/automation/types';

export const STEP_NODE = 'step';
export const INSERT_EDGE = 'insert';

export interface StepNodeData extends Record<string, unknown> {
  nodeType: string;
  config: Record<string, unknown>;
}

export function toFlowNodes(graph: AutomationGraph): Node<StepNodeData>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: STEP_NODE,
    position: node.position,
    data: {
      nodeType: node.type,
      config: node.data?.config ?? {},
    },
  }));
}

export function toFlowEdges(graph: AutomationGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: INSERT_EDGE,
  }));
}

export function toGraph(
  nodes: Node<StepNodeData>[],
  edges: Edge[]
): AutomationGraph {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      position: node.position,
      data: { config: node.data.config ?? {} },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}
