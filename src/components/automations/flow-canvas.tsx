'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  MarkerType,
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
import { defaultsFromCatalog } from '@/lib/automation/present';
import type { AutomationGraph } from '@/lib/automation/types';

import { ConfigPanel } from './config-panel';
import { ChooseFirstStep } from './choose-first-step';
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
const defaultEdgeOptions = {
  type: INSERT_EDGE,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#b7c0cc',
    width: 16,
    height: 16,
  },
};
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
  const lastCommitted = useRef<string>('');
  const pendingCommit = useRef<{
    nodes: Node<StepNodeData>[];
    edges: Edge[];
  } | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const commit = useCallback(
    (nextNodes: Node<StepNodeData>[], nextEdges: Edge[]) => {
      // Never call the parent's onChange synchronously from a React Flow
      // change handler: React Flow may invoke those handlers during the
      // canvas render phase, and a synchronous parent setState there
      // triggers "Cannot update a component while rendering" plus a
      // render→commit→render churn (runaway PATCH autosaves, CPU spin).
      // Stage the snapshot here; the flush effect below delivers it.
      pendingCommit.current = { nodes: nextNodes, edges: nextEdges };
    },
    []
  );

  const placeAfter = useCallback((sourceId: string, sourceHandle?: string) => {
    setPicker({ mode: 'after', sourceId, sourceHandle });
  }, []);

  // ManyChat-style dot interaction: clicking (or dropping on empty
  // canvas from) a source connection dot opens the same picker as the
  // "+" buttons, pre-wired to that handle. Dragging dot-to-node keeps
  // the native React Flow connect behavior via onConnect.
  const connectStart = useRef<{
    nodeId: string | null;
    handleId: string | null;
    handleType: string | null;
  }>({ nodeId: null, handleId: null, handleType: null });

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const current = nodesRef.current;
      const source = current.find((node) => node.id === nodeId);
      if (!source) return;
      const id = crypto.randomUUID();
      const nextNodes = [
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
      ];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      commit(nextNodes, edgesRef.current);
      setSelectedId(id);
    },
    [commit]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId);
      const nextEdges = edgesRef.current.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      );
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      commit(nextNodes, nextEdges);
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
      // The canvas now mirrors this graph, so a staged commit with the
      // same content (e.g. re-applying an undone edit by hand) must not
      // be mistaken for a no-op skip or a fresh change.
      lastCommitted.current = signature;
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

  // Deliver staged commits outside the render phase. Drops snapshots
  // whose content matches what the canvas already mirrors, so
  // drag-end-without-movement and render-phase echoes from React Flow
  // never reach the parent (and never trigger autosave PATCHes).
  useEffect(() => {
    if (!pendingCommit.current) return;
    const { nodes: pendingNodes, edges: pendingEdges } =
      pendingCommit.current;
    pendingCommit.current = null;
    const graph = toGraph(pendingNodes, pendingEdges);
    const signature = graphSignature(graph);
    if (signature === lastCommitted.current) return;
    lastCommitted.current = signature;
    onChange(graph);
  });

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<StepNodeData>>[]) => {
      const select = changes.find((change) => change.type === 'select');
      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);
      const persist = changes.some((change) => {
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
      if (select && select.type === 'select') {
        setSelectedId(select.selected ? select.id : null);
      }
    },
    [commit]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const next = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = next;
      setEdges(next);
      if (changes.some((change) => change.type === 'remove')) {
        commit(nodesRef.current, next);
      }
    },
    [commit]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      const nextEdges = addEdge(
        { ...connection, type: INSERT_EDGE },
        edgesRef.current
      );
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      commit(nodesRef.current, nextEdges);
    },
    [commit, readOnly]
  );

  const onConnectStart = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null; handleType: string | null }
    ) => {
      connectStart.current = params;
    },
    []
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const { nodeId, handleId, handleType } = connectStart.current;
      connectStart.current = { nodeId: null, handleId: null, handleType: null };
      if (readOnly || handleType !== 'source' || !nodeId) return;
      const target = event.target as HTMLElement | null;
      // Dropped on a node → onConnect already wired the edge.
      if (target?.closest?.('.react-flow__node')) return;
      setPicker({ mode: 'after', sourceId: nodeId, sourceHandle: handleId });
    },
    [readOnly]
  );

  const selected = nodes.find((node) => node.id === selectedId);
  const selectedCatalog = selected
    ? catalogMap.get(selected.data.nodeType)
    : undefined;
  const hasTrigger = graph.nodes.some((node) => {
    const kind = catalogMap.get(node.type)?.kind;
    return kind === 'trigger';
  });

  // ManyChat "Choose first step" panel: shown when a trigger node has
  // no outgoing edge yet. Derived from live canvas state (not
  // persisted), so it appears/disappears automatically as edges change.
  const danglingTrigger = useMemo(() => {
    if (readOnly) return null;
    const trigger = nodes.find(
      (node) => catalogMap.get(node.data.nodeType)?.kind === 'trigger'
    );
    if (!trigger) return null;
    const hasOutgoing = edges.some((edge) => edge.source === trigger.id);
    return hasOutgoing ? null : trigger;
  }, [nodes, edges, catalogMap, readOnly]);

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
        x: (source?.position.x ?? 64) + 340,
        y:
          (source?.position.y ?? 180) +
          (picker.sourceHandle === 'false'
            ? 200
            : picker.sourceHandle === 'true'
              ? -20
              : 0),
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
          x: (source?.position.x ?? 64) + 170,
          y: source?.position.y ?? 180,
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
      ...nodesRef.current,
      {
        id,
        type: STEP_NODE,
        position,
        data: { nodeType: def.type, config: defaultsFromCatalog(def) },
      },
    ];
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    commit(nextNodes, nextEdges);
    setSelectedId(id);
    setPicker(null);
    void fitView({ padding: 0.2, duration: 250 });
  }

  return (
    <div className="flex h-full min-h-[420px] w-full bg-[#f7f9fc]">
      {selected && (
        <aside className="step-editor z-30 flex h-full w-[min(100%,380px)] shrink-0 flex-col border-r border-slate-200 bg-white">
          <ConfigPanel
            catalog={selectedCatalog}
            catalogList={catalog}
            config={selected.data.config}
            errors={issues.get(selected.id) ?? []}
            readOnly={readOnly}
            onClose={() => setSelectedId(null)}
            onChangeType={(type) => {
              const def = catalogMap.get(type);
              if (!def || def.kind !== 'trigger') return;
              const next = nodesRef.current.map((node) =>
                node.id === selected.id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        nodeType: def.type,
                        config: defaultsFromCatalog(def),
                      },
                    }
                  : node
              );
              nodesRef.current = next;
              setNodes(next);
              commit(next, edgesRef.current);
            }}
            onChange={(config) => {
              const next = nodesRef.current.map((node) =>
                node.id === selected.id
                  ? { ...node, data: { ...node.data, config } }
                  : node
              );
              nodesRef.current = next;
              setNodes(next);
              commit(next, edgesRef.current);
            }}
          />
        </aside>
      )}
      <div className="relative min-w-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={(event) => {
          setSelectedId(null);
          if (readOnly) {
            setPicker(null);
            return;
          }
          if (event.detail < 2) {
            setPicker(null);
            return;
          }
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

      {danglingTrigger && (
        <ChooseFirstStep
          x={danglingTrigger.position.x}
          y={danglingTrigger.position.y}
          onPick={() =>
            setPicker({ mode: 'after', sourceId: danglingTrigger.id })
          }
        />
      )}

      {!readOnly && (
        <div
          className="absolute top-4 z-40 flex items-start gap-3"
          style={{ right: 16 }}
        >
          {picker && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-[0_12px_40px_rgba(31,41,55,0.12)]">
              <NodePicker
                catalog={catalog}
                allowTriggers={!hasTrigger}
                onPick={placeNode}
              />
            </div>
          )}
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6fed] text-white shadow-lg hover:bg-[#2559c4]"
            onClick={() =>
              setPicker((current) =>
                current
                  ? null
                  : selectedId
                    ? { mode: 'after', sourceId: selectedId }
                    : { mode: 'free', position: { x: 420, y: 180 } }
              )
            }
            aria-label="Add a step"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
