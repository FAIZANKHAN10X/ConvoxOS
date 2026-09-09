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
  const outgoing = catalog?.ports.outgoing ?? [
    { id: 'default', label: 'Next' },
  ];
  const branched = outgoing.length > 1;
  const errors = data.errors ?? [];
  const summary = summarize(catalog, data.config);
  const accent = catalog ? CATEGORY_ACCENT[catalog.category] : '#2f6fed';
  const unconfigured = !summary && errors.length > 0;

  if (isTrigger) {
    return (
      <div
        className={cn(
          'group relative w-[280px] rounded-[22px] px-5 py-4 text-white shadow-[0_10px_28px_rgba(31,41,55,0.18)]',
          selected &&
            'ring-2 ring-[#2f6fed] ring-offset-2 ring-offset-[#e8edf3]',
          unconfigured && !selected && 'ring-2 ring-amber-400'
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
        {outgoing.map((handle, index) => (
          <Handle
            key={handle.id}
            type="source"
            id={handle.id === 'default' ? undefined : handle.id}
            position={Position.Bottom}
            style={
              outgoing.length > 1
                ? { left: `${((index + 1) / (outgoing.length + 1)) * 100}%` }
                : undefined
            }
            className="!h-3 !w-3 !border-2 !border-white !bg-[#8b93a3]"
          />
        ))}
        {!data.readOnly && (
          <button
            type="button"
            className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-white text-[#3a4150] shadow-md"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddAfter?.(id, outgoing[0]?.id);
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
      {catalog?.ports.incoming !== false && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-[#c5ced8]"
        />
      )}
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
      {branched ? (
        <div className="relative px-6 pb-3">
          <div className="flex justify-between text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            {outgoing.map((handle) => (
              <span key={handle.id}>{handle.label}</span>
            ))}
          </div>
          {outgoing.map((handle, index) => (
            <Handle
              key={handle.id}
              type="source"
              id={handle.id}
              position={Position.Bottom}
              style={{
                left: `${((index + 1) / (outgoing.length + 1)) * 100}%`,
              }}
              className={cn(
                '!h-3 !w-3 !border-2 !border-white',
                handle.id === 'true' ? '!bg-emerald-500' : '!bg-rose-500'
              )}
            />
          ))}
          {!data.readOnly &&
            outgoing.map((handle, index) => (
              <button
                key={`add-${handle.id}`}
                type="button"
                className="nodrag nopan absolute -bottom-3 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-md"
                style={{
                  left: `${((index + 1) / (outgoing.length + 1)) * 100}%`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onAddAfter?.(id, handle.id);
                }}
                aria-label={`Add ${handle.label} step`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            ))}
        </div>
      ) : (
        <>
          <Handle
            type="source"
            id={outgoing[0]?.id === 'default' ? undefined : outgoing[0]?.id}
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-white !bg-[#c5ced8]"
          />
          {!data.readOnly && (
            <button
              type="button"
              className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-md"
              onClick={(event) => {
                event.stopPropagation();
                data.onAddAfter?.(id, outgoing[0]?.id);
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
  const keywords = config.keywords;
  if (Array.isArray(keywords) && keywords.length > 0) {
    const matchType =
      typeof config.matchType === 'string' ? config.matchType : 'contains';
    return `${matchType}: ${keywords.slice(0, 3).join(', ')}`;
  }
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
  const predicate = config.predicate ?? config.subject;
  if (typeof predicate === 'string' && predicate) {
    return predicate.replaceAll('_', ' ').replaceAll('.', ' · ');
  }
  const channel = config.channel;
  if (typeof channel === 'string' && channel && channel !== 'current') {
    return catalog?.kind === 'trigger' ? `On ${channel}` : `Via ${channel}`;
  }
  return '';
}
