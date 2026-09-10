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
  // Branch paths follow the declared port: Yes → green, No → red,
  // everything else ManyChat gray. Driven by the edge's source handle,
  // never by node type.
  const stroke =
    data?.sourceHandle === 'true'
      ? '#22c55e'
      : data?.sourceHandle === 'false'
        ? '#ef4444'
        : '#b7c0cc';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke, strokeWidth: 2 }}
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
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-[#2f6fed] hover:text-[#2f6fed]"
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
