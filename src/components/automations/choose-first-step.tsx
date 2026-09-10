'use client';

import { useViewport } from '@xyflow/react';

interface ChooseFirstStepProps {
  /** Trigger node position in flow coordinates. */
  x: number;
  y: number;
  onPick: () => void;
}

/**
 * ManyChat-style dashed "Choose first step" panel. Rendered as a
 * viewport-tracked overlay (not a graph node) so it can never be
 * persisted, validated, or executed — it vanishes the moment the
 * trigger gains an outgoing edge.
 */
export function ChooseFirstStep({ x, y, onPick }: ChooseFirstStepProps) {
  const { x: vx, y: vy, zoom } = useViewport();
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label="Choose first step"
      className="absolute z-10 w-[240px] rounded-2xl border-2 border-dashed border-slate-300 bg-white/85 p-4 text-left shadow-sm backdrop-blur-[1px] transition-colors hover:border-[#2f6fed] hover:bg-white"
      style={{ left: x * zoom + vx + 312 * zoom, top: y * zoom + vy }}
    >
      <p className="text-[15px] font-semibold text-slate-800">
        Choose first step 👇
      </p>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">
        Pick what happens after the trigger.
      </p>
    </button>
  );
}
