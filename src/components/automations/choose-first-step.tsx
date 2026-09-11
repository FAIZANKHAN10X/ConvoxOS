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
      className="absolute z-10 w-[240px] rounded-lg border border-dashed border-border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary"
      style={{ left: x * zoom + vx + 312 * zoom, top: y * zoom + vy }}
    >
      <p className="text-sm font-semibold text-foreground">
        Choose first step
      </p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
        Pick what happens after the trigger.
      </p>
    </button>
  );
}
