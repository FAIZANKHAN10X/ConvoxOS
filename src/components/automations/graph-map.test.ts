import { describe, expect, it } from 'vitest';

import { starterGraph } from '@/lib/automation/graph';

import { toFlowEdges, toFlowNodes, toGraph } from './graph-map';

describe('graph-map', () => {
  it('round-trips the automation graph through the React Flow view model', () => {
    const graph = starterGraph();
    graph.edges.push({
      id: 'e1',
      source: 'start',
      target: 'n2',
      sourceHandle: null,
      targetHandle: null,
    });
    graph.nodes.push({
      id: 'n2',
      type: 'action.send_text',
      position: { x: 10, y: 20 },
      data: { config: { text: 'hi' } },
    });
    const roundTrip = toGraph(toFlowNodes(graph), toFlowEdges(graph));
    expect(roundTrip.nodes.map((n) => n.type)).toEqual([
      'trigger.message_received',
      'action.send_text',
    ]);
    expect(roundTrip.edges[0]?.source).toBe('start');
    expect(roundTrip.nodes[1]?.data.config).toEqual({ text: 'hi' });
  });
});
