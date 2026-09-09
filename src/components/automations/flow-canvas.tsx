'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import {
  issuesByNode,
  validateDraftGraph,
} from '@/lib/automation/client-validate';
import type { AutomationGraph } from '@/lib/automation/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import { ConfigPanel } from './config-panel';
import {
  INSERT_EDGE,
  STEP_NODE,
  type StepNodeData,
  toFlowEdges,
  toFlowNodes,
  toGraph,
} from './graph-map';
import { InsertEdge } from './insert-edge';
import { NodePicker } from './node-picker';
import { StepNode } from './step-node';

const nodeTypes = { [STEP_NODE]: StepNode };
const edgeTypes = { [INSERT_EDGE]: InsertEdge };

interface FlowCanvasProps {
  graph: AutomationGraph;
  catalog: CatalogNode[];
  readOnly?: boolean;
  onChange: (graph: AutomationGraph) => void;
}

type PickerTarget =
  | { mode: 'free'; position: { x: number; y: number } }
  | { mode: 'after'; sourceId: string; sourceHandle?: string | null }
  | { mode: 'edge'; edgeId: string };

export function FlowCanvas({
  graph,
  catalog,
  readOnly,
  onChange,
}: FlowCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const catalogMap = useMemo(
    () => new Map(catalog.map((node) => [node.type, node])),
    [catalog]
  );
  const issues = useMemo(
    () => issuesByNode(validateDraftGraph(graph, catalog)),
    [catalog, graph]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [nodes, setNodes] = useState<Node<StepNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const commit = useCallback(
    (nextNodes: Node<StepNodeData>[], nextEdges: Edge[]) => {
      onChange(toGraph(nextNodes, nextEdges));
    },
    [onChange]
  );

  const placeAfter = useCallback((sourceId: string, sourceHandle?: string) => {
    setPicker({ mode: 'after', sourceId, sourceHandle });
  }, []);

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((node) => node.id === nodeId);
      if (!source) return;
      const id = crypto.randomUUID();
      const nextNodes: Node<StepNodeData>[] = [
        ...nodes,
        {
          ...source,
          id,
          position: {
            x: source.position.x + 48,
            y: source.position.y + 48,
          },
          selected: true,
          data: {
            nodeType: source.data.nodeType,
            config: { ...source.data.config },
          },
        },
      ];
      commit(nextNodes, edges);
      setSelectedId(id);
    },
    [commit, edges, nodes]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      commit(
        nodes.filter((node) => node.id !== nodeId),
        edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      );
      setSelectedId((current) => (current === nodeId ? null : current));
    },
    [commit, edges, nodes]
  );

  useEffect(() => {
    setNodes(
      toFlowNodes(graph).map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          catalog: catalogMap.get(node.data.nodeType),
          errors: issues.get(node.id) ?? [],
          readOnly,
          onAddAfter: readOnly ? undefined : placeAfter,
          onDuplicate: readOnly ? undefined : duplicateNode,
          onDelete: readOnly ? undefined : deleteNode,
        },
      }))
    );
    setEdges(
      toFlowEdges(graph).map((edge) => ({
        ...edge,
        data: {
          onInsert: readOnly
            ? undefined
            : (edgeId: string) => setPicker({ mode: 'edge', edgeId }),
        },
      }))
    );
    // selectedId is applied above; don't retrigger sync on selection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalogMap,
    deleteNode,
    duplicateNode,
    graph,
    issues,
    placeAfter,
    readOnly,
  ]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<StepNodeData>>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        const select = changes.find((change) => change.type === 'select');
        if (select && select.type === 'select') {
          setSelectedId(select.selected ? select.id : null);
        }
        const persist = changes.some(
          (change) =>
            change.type === 'remove' ||
            (change.type === 'position' && change.dragging === false)
        );
        if (persist) commit(next, edges);
        return next;
      });
    },
    [commit, edges]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (changes.some((change) => change.type === 'remove')) {
          commit(nodes, next);
        }
        return next;
      });
    },
    [commit, nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      commit(nodes, addEdge({ ...connection, type: INSERT_EDGE }, edges));
    },
    [commit, edges, nodes, readOnly]
  );

  const selected = nodes.find((node) => node.id === selectedId);
  const selectedCatalog = selected
    ? catalogMap.get(selected.data.nodeType)
    : undefined;
  const hasTrigger = graph.nodes.some((node) => {
    const kind = catalogMap.get(node.type)?.kind;
    return kind === 'trigger';
  });

  function placeNode(def: CatalogNode) {
    if (!picker) return;
    const id = crypto.randomUUID();
    let position = { x: 320, y: 200 };
    let nextEdges = edges;

    if (picker.mode === 'free') {
      position = picker.position;
    } else if (picker.mode === 'after') {
      const source = nodes.find((node) => node.id === picker.sourceId);
      position = {
        x:
          (source?.position.x ?? 320) +
          (picker.sourceHandle === 'false' ? 220 : 0),
        y: (source?.position.y ?? 80) + 160,
      };
      nextEdges = addEdge(
        {
          id: `e-${picker.sourceId}-${id}`,
          source: picker.sourceId,
          target: id,
          sourceHandle: picker.sourceHandle ?? undefined,
          type: INSERT_EDGE,
        },
        nextEdges
      );
    } else {
      const edge = edges.find((item) => item.id === picker.edgeId);
      if (edge) {
        const source = nodes.find((node) => node.id === edge.source);
        position = {
          x: source?.position.x ?? 320,
          y: (source?.position.y ?? 80) + 90,
        };
        nextEdges = nextEdges.filter((item) => item.id !== edge.id);
        nextEdges = addEdge(
          {
            id: `e-${edge.source}-${id}`,
            source: edge.source,
            target: id,
            sourceHandle: edge.sourceHandle,
            type: INSERT_EDGE,
          },
          nextEdges
        );
        nextEdges = addEdge(
          {
            id: `e-${id}-${edge.target}`,
            source: id,
            target: edge.target,
            type: INSERT_EDGE,
          },
          nextEdges
        );
      }
    }

    const nextNodes: Node<StepNodeData>[] = [
      ...nodes,
      {
        id,
        type: STEP_NODE,
        position,
        data: { nodeType: def.type, config: {} },
      },
    ];
    commit(nextNodes, nextEdges);
    setSelectedId(id);
    setPicker(null);
  }

  return (
    <div className="relative h-full min-h-[420px] w-full bg-[#e8edf3]">
      <ReactFlow
        nodes={nodes.map((node) => ({
          ...node,
          selected: node.id === selectedId,
        }))}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={(event) => {
          setSelectedId(null);
          if (readOnly || event.detail < 2) return;
          const position = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          setPicker({ mode: 'free', position });
        }}
        fitView
        deleteKeyCode={readOnly ? [] : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        className="bg-[#e8edf3]"
        defaultEdgeOptions={{ type: INSERT_EDGE }}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        panOnDrag
      >
        <Background gap={22} size={1} color="#c5ced8" />
        <MiniMap
          pannable
          zoomable
          className="!border-slate-200 !bg-white/90"
          maskColor="rgb(58 65 80 / 12%)"
        />
        <Controls
          showInteractive={!readOnly}
          className="!border-slate-200 !bg-white !shadow-sm"
          onFitView={() => void fitView({ padding: 0.2 })}
        />
      </ReactFlow>

      {!readOnly && (
        <div
          className={`absolute top-4 z-20 flex flex-col gap-2 ${
            selected ? 'right-[400px]' : 'right-4'
          }`}
        >
          <Popover
            open={picker !== null}
            onOpenChange={(open) => {
              if (!open) setPicker(null);
            }}
          >
            <PopoverTrigger
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3a4150] text-white shadow-lg"
              onClick={() =>
                setPicker(
                  selectedId
                    ? { mode: 'after', sourceId: selectedId }
                    : { mode: 'free', position: { x: 360, y: 180 } }
                )
              }
              aria-label="Add a step"
            >
              <Plus className="h-5 w-5" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="left"
              className="w-auto border-slate-200 p-4"
            >
              <NodePicker
                catalog={catalog}
                allowTriggers={!hasTrigger}
                onPick={placeNode}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {selected && (
        <aside className="absolute inset-y-0 right-0 z-30 w-[min(100%,380px)] border-l border-slate-200 bg-white shadow-[-12px_0_32px_rgba(31,41,55,0.08)]">
          <ConfigPanel
            catalog={selectedCatalog}
            config={selected.data.config}
            errors={issues.get(selected.id) ?? []}
            readOnly={readOnly}
            onClose={() => setSelectedId(null)}
            onChange={(config) => {
              const next = nodes.map((node) =>
                node.id === selected.id
                  ? { ...node, data: { ...node.data, config } }
                  : node
              );
              commit(next, edges);
            }}
          />
        </aside>
      )}
    </div>
  );
}
