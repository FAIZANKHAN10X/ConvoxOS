'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, Plus, Trash2 } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { cn } from '@/lib/utils';

import type { StepNodeData } from './graph-map';
import { CATEGORY_ACCENT, CATEGORY_ICON } from './kind-theme';

export function StepNode({
  id,
  data,
  selected,
}: NodeProps & {
  data: StepNodeData & {
    catalog?: CatalogNode;
    errors?: string[];
    readOnly?: boolean;
    onAddAfter?: (nodeId: string, handle?: string) => void;
    onDuplicate?: (nodeId: string) => void;
    onDelete?: (nodeId: string) => void;
  };
}) {
  const catalog = data.catalog;
  const Icon =
    (catalog && CATEGORY_ICON[catalog.category]) || CATEGORY_ICON.communication;
  const isTrigger = catalog?.kind === 'trigger';
  const isCondition = catalog?.kind === 'condition';
  const errors = data.errors ?? [];
  const summary = summarize(catalog, data.config);
  const accent = catalog ? CATEGORY_ACCENT[catalog.category] : '#2f6fed';

  if (isTrigger) {
    return (
      <div
        className={cn(
          'group relative w-[280px] rounded-[22px] px-5 py-4 text-white shadow-[0_10px_28px_rgba(31,41,55,0.18)]',
          selected &&
            'ring-2 ring-[#2f6fed] ring-offset-2 ring-offset-[#e8edf3]'
        )}
        style={{ background: CATEGORY_ACCENT.trigger }}
      >
        <p className="text-[10px] font-semibold tracking-[0.16em] text-white/55 uppercase">
          Starting Step
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/12">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">
              {catalog?.label ?? 'Trigger'}
            </p>
            <p className="truncate text-xs text-white/65">
              {summary || (errors[0] ?? 'Configure this trigger')}
            </p>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-white !bg-[#8b93a3]"
        />
        {!data.readOnly && (
          <button
            type="button"
            className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-white text-[#3a4150] shadow-md"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddAfter?.(id);
            }}
            aria-label="Add next step"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative w-[280px] rounded-[18px] bg-white shadow-[0_8px_24px_rgba(31,41,55,0.08)]',
        selected && 'ring-2 ring-[#2f6fed]',
        errors.length > 0 && !selected && 'ring-2 ring-red-400'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-white !bg-[#c5ced8]"
      />
      {!data.readOnly && (
        <div className="absolute -top-3 right-3 z-10 hidden gap-1 group-hover:flex">
          <button
            type="button"
            className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"
            onClick={(event) => {
              event.stopPropagation();
              data.onDuplicate?.(id);
            }}
            aria-label="Duplicate step"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-full bg-white text-red-500 shadow-sm"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(id);
            }}
            aria-label="Delete step"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-slate-800">
            {catalog?.label ?? data.nodeType}
          </p>
          <p
            className={cn(
              'mt-0.5 line-clamp-3 text-[13px] leading-snug',
              errors.length > 0 && !summary ? 'text-red-500' : 'text-slate-500'
            )}
          >
            {summary || errors[0] || 'Click to configure'}
          </p>
        </div>
      </div>
      {isCondition ? (
        <div className="relative px-6 pb-3">
          <div className="flex justify-between text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            <span>Yes</span>
            <span>No</span>
          </div>
          <Handle
            type="source"
            id="true"
            position={Position.Bottom}
            style={{ left: '28%' }}
            className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500"
          />
          <Handle
            type="source"
            id="false"
            position={Position.Bottom}
            style={{ left: '72%' }}
            className="!h-3 !w-3 !border-2 !border-white !bg-rose-500"
          />
        </div>
      ) : (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-white !bg-[#c5ced8]"
          />
          {!data.readOnly && (
            <button
              type="button"
              className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-md"
              onClick={(event) => {
                event.stopPropagation();
                data.onAddAfter?.(id);
              }}
              aria-label="Add next step"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function summarize(
  catalog: CatalogNode | undefined,
  config: Record<string, unknown>
): string {
  const text = config.text;
  if (typeof text === 'string' && text.trim()) {
    return text.trim().length > 72
      ? `${text.trim().slice(0, 72)}…`
      : text.trim();
  }
  const amount = config.amount;
  const unit = config.unit;
  if (typeof amount === 'number' && typeof unit === 'string') {
    return `Wait ${amount} ${unit}`;
  }
  if (catalog?.kind === 'condition') {
    const subject = config.subject;
    if (typeof subject === 'string') return subject.replaceAll('_', ' ');
  }
  return '';
}
