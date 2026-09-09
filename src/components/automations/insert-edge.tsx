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
  data,
}: EdgeProps & {
  data?: { onInsert?: (edgeId: string) => void };
}) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: '#b7c0cc', strokeWidth: 2 }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="nodrag nopan absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-[#2f6fed] hover:text-[#2f6fed]"
          style={{ left: labelX, top: labelY }}
          onClick={(event) => {
            event.stopPropagation();
            data?.onInsert?.(id);
          }}
          aria-label="Insert step"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
