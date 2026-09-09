'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Controls,
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
import { useTagNames } from './use-tags';

const nodeTypes = { [STEP_NODE]: StepNode };
const edgeTypes = { [INSERT_EDGE]: InsertEdge };
const defaultEdgeOptions = { type: INSERT_EDGE };
const deleteKeys = ['Backspace', 'Delete'];
const noKeys: string[] = [];

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

function graphSignature(graph: AutomationGraph): string {
  return JSON.stringify({
    n: graph.nodes.map((node) => [
      node.id,
      node.type,
      Math.round(node.position.x),
      Math.round(node.position.y),
      node.data?.config ?? {},
    ]),
    e: graph.edges.map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.sourceHandle ?? '',
      edge.targetHandle ?? '',
    ]),
  });
}

export function FlowCanvas({
  graph,
  catalog,
  readOnly,
  onChange,
}: FlowCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const tagNames = useTagNames();
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
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
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const draggingRef = useRef(false);
  const didFit = useRef(false);
  const lastSignature = useRef<string>('');
  nodesRef.current = nodes;
  edgesRef.current = edges;

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
      const current = nodesRef.current;
      const source = current.find((node) => node.id === nodeId);
      if (!source) return;
      const id = crypto.randomUUID();
      commit(
        [
          ...current,
          {
            ...source,
            id,
            selected: true,
            position: {
              x: source.position.x + 48,
              y: source.position.y + 48,
            },
            data: {
              nodeType: source.data.nodeType,
              config: { ...source.data.config },
            },
          },
        ],
        edgesRef.current
      );
      setSelectedId(id);
    },
    [commit]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      commit(
        nodesRef.current.filter((node) => node.id !== nodeId),
        edgesRef.current.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId
        )
      );
      setSelectedId((current) => (current === nodeId ? null : current));
    },
    [commit]
  );

  const insertOnEdge = useCallback((edgeId: string) => {
    setPicker({ mode: 'edge', edgeId });
  }, []);

  useEffect(() => {
    const signature = graphSignature(graph);
    const catalog = catalogRef.current;
    const catalogByType = new Map(catalog.map((node) => [node.type, node]));
    const nextIssues = issuesByNode(validateDraftGraph(graph, catalog));

    const needsHydrate =
      signature !== lastSignature.current ||
      (graph.nodes.length > 0 && nodesRef.current.length === 0);
    if (needsHydrate) {
      lastSignature.current = signature;
      setNodes(
        toFlowNodes(graph).map((node) => ({
          ...node,
          selected: node.id === selectedId,
          data: {
            ...node.data,
            catalog: catalogByType.get(node.data.nodeType),
            errors: nextIssues.get(node.id) ?? [],
            readOnly,
            tagNames,
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
            sourceHandle: edge.sourceHandle,
            onInsert: readOnly ? undefined : insertOnEdge,
          },
        }))
      );
      return;
    }

    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const errors = nextIssues.get(node.id) ?? [];
        const prevErrors = (node.data.errors as string[] | undefined) ?? [];
        const sameErrors =
          errors.length === prevErrors.length &&
          errors.every((error, index) => error === prevErrors[index]);
        if (
          sameErrors &&
          node.data.readOnly === readOnly &&
          node.data.tagNames === tagNames
        )
          return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            errors,
            readOnly,
            tagNames,
            catalog: catalogByType.get(node.data.nodeType),
            onAddAfter: readOnly ? undefined : placeAfter,
            onDuplicate: readOnly ? undefined : duplicateNode,
            onDelete: readOnly ? undefined : deleteNode,
          },
        };
      });
      return changed ? next : current;
    });
    // selectedId is patched separately so clicks do not rebuild the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, readOnly, tagNames, placeAfter, duplicateNode, deleteNode, insertOnEdge]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === selectedId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedId]);

  useEffect(() => {
    if (didFit.current || nodes.length === 0) return;
    didFit.current = true;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.2 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodes.length]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<StepNodeData>>[]) => {
      const select = changes.find((change) => change.type === 'select');
      let persist = false;
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        persist = changes.some((change) => {
          if (change.type === 'remove') return true;
          if (change.type !== 'position') return false;
          if (change.dragging) {
            draggingRef.current = true;
            return false;
          }
          if (change.dragging === false && draggingRef.current) {
            draggingRef.current = false;
            return true;
          }
          return false;
        });
        if (persist) commit(next, edgesRef.current);
        return next;
      });
      if (select && select.type === 'select') {
        setSelectedId(select.selected ? select.id : null);
      }
    },
    [commit]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (changes.some((change) => change.type === 'remove')) {
          commit(nodesRef.current, next);
        }
        return next;
      });
    },
    [commit]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      commit(
        nodesRef.current,
        addEdge({ ...connection, type: INSERT_EDGE }, edgesRef.current)
      );
    },
    [commit, readOnly]
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
    let nextEdges = edgesRef.current;

    if (picker.mode === 'free') {
      position = picker.position;
    } else if (picker.mode === 'after') {
      const source = nodesRef.current.find(
        (node) => node.id === picker.sourceId
      );
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
      const edge = nextEdges.find((item) => item.id === picker.edgeId);
      if (edge) {
        const source = nodesRef.current.find((node) => node.id === edge.source);
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

    commit(
      [
        ...nodesRef.current,
        {
          id,
          type: STEP_NODE,
          position,
          data: { nodeType: def.type, config: {} },
        },
      ],
      nextEdges
    );
    setSelectedId(id);
    setPicker(null);
  }

  return (
    <div className="relative h-full min-h-[420px] w-full bg-[#f7f9fc]">
      <ReactFlow
        nodes={nodes}
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
        deleteKeyCode={readOnly ? noKeys : deleteKeys}
        className="bg-[#f7f9fc]"
        defaultEdgeOptions={defaultEdgeOptions}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        panOnDrag
        minZoom={0.4}
        maxZoom={1.5}
      >
        <Controls
          showInteractive={!readOnly}
          position="bottom-right"
          className="!m-4 !gap-1 !border-0 !bg-transparent !shadow-none [&>button]:!h-8 [&>button]:!w-8 [&>button]:!rounded-lg [&>button]:!border [&>button]:!border-slate-200 [&>button]:!bg-white [&>button]:!shadow-sm"
        />
      </ReactFlow>

      {!readOnly && (
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
          <Popover
            open={picker !== null}
            onOpenChange={(open) => {
              if (!open) setPicker(null);
            }}
          >
            <PopoverTrigger
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6fed] text-white shadow-lg hover:bg-[#2559c4]"
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
        <aside className="absolute inset-y-0 left-0 z-30 w-[min(100%,380px)] border-r border-slate-200 bg-white shadow-[12px_0_32px_rgba(31,41,55,0.08)]">
          <ConfigPanel
            catalog={selectedCatalog}
            config={selected.data.config}
            errors={issues.get(selected.id) ?? []}
            readOnly={readOnly}
            onClose={() => setSelectedId(null)}
            onChange={(config) => {
              const next = nodesRef.current.map((node) =>
                node.id === selected.id
                  ? { ...node, data: { ...node.data, config } }
                  : node
              );
              commit(next, edgesRef.current);
            }}
          />
        </aside>
      )}
    </div>
  );
}
