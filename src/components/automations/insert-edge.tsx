'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { Plus } from 'lucide-react';

export function InsertEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps & {
  data?: { onInsert?: (edgeId: string) => void; sourceHandle?: string | null };
}) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  // Branch paths follow the declared port: Yes → success green, No →
  // destructive red, everything else the muted-foreground token. Driven
  // by the edge's source handle, never by node type. Colors are
  // theme-aware CSS vars so edges stay readable in both modes.
  const stroke =
    data?.sourceHandle === 'true'
      ? 'var(--edge-true, #16a34a)'
      : data?.sourceHandle === 'false'
        ? 'var(--edge-false, #dc2626)'
        : 'var(--edge-idle, #9aa4b2)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke, strokeWidth: 1.75 }}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 20,
          }}
        >
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground shadow-xs transition-colors hover:border-primary hover:text-primary"
            onClick={(event) => {
              event.stopPropagation();
              data?.onInsert?.(id);
            }}
            aria-label="Insert step"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
