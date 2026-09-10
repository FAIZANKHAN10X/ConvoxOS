'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, Plus, Trash2, Zap } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { placeholderFor, summarizeNode } from '@/lib/automation/present';
import { cn } from '@/lib/utils';

import type { StepNodeData } from './graph-map';
import { CATEGORY_BADGE, CATEGORY_BAND, CATEGORY_ICON } from './kind-theme';

const MANYCHAT_BLUE = '#2f6fed';

export function StepNode({
  id,
  data,
  selected,
}: NodeProps & {
  data: StepNodeData & {
    catalog?: CatalogNode;
    errors?: string[];
    readOnly?: boolean;
    tagNames?: Record<string, string>;
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
  const summary = catalog
    ? summarizeNode(catalog, data.config, data.tagNames)
    : '';
  const empty = catalog
    ? placeholderFor(catalog, data.config)
    : 'Click to configure';
  const unconfigured = !summary;

  if (isTrigger) {
    return (
      <div
        className={cn(
          'group relative w-[280px] rounded-[18px] border bg-white px-5 py-4 shadow-[0_8px_24px_rgba(31,41,55,0.10)]',
          selected
            ? 'border-transparent ring-2 ring-[#22c55e]'
            : 'border-slate-200',
          unconfigured && !selected && 'border-dashed border-amber-400'
        )}
      >
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Zap className="h-3.5 w-3.5 text-[#16a34a]" />
          When…
        </p>
        <p className="mt-1 truncate text-[15px] font-semibold text-slate-900">
          {catalog?.label ?? 'Trigger'}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {summary || empty}
        </p>
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
            className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-[#2f6fed] text-white opacity-0 shadow-md group-hover:opacity-100"
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

  const band = catalog ? CATEGORY_BAND[catalog.category] : '#ffffff';
  const badge = catalog ? CATEGORY_BADGE[catalog.category] : MANYCHAT_BLUE;
  const previewMessage =
    catalog?.preview === 'message' &&
    typeof data.config.text === 'string' &&
    data.config.text.trim()
      ? data.config.text.trim()
      : null;

  return (
    <div
      className={cn(
        'group relative w-[280px] overflow-visible rounded-[18px] border bg-white shadow-[0_8px_24px_rgba(31,41,55,0.10)]',
        selected ? 'border-transparent ring-2 ring-[#22c55e]' : 'border-slate-200',
        errors.length > 0 && !selected && 'border-red-300'
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
        <div className="absolute top-2 right-2 z-10 hidden gap-1 group-hover:flex">
          <button
            type="button"
            className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 shadow-md"
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
            className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-full bg-white text-red-500 shadow-md"
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
      <div
        className="flex items-center gap-2.5 px-4 pt-3 pb-2.5"
        style={{ background: band }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: badge }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-slate-900">
            {catalog?.label ?? data.nodeType}
          </p>
          {band === '#ffffff' && (
            <p className="truncate text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              {catalog?.category === 'communication'
                ? 'Message'
                : (catalog?.category ?? 'Step')}
            </p>
          )}
        </div>
      </div>
      <div className="px-4 pt-2.5 pb-3">
        {previewMessage ? (
          <div className="rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2">
            <p className="line-clamp-4 text-[13px] leading-snug text-slate-700">
              {previewMessage}
            </p>
          </div>
        ) : (
          <p
            className={cn(
              'line-clamp-3 text-[13px] leading-snug',
              errors.length > 0 && !summary ? 'text-red-500' : 'text-slate-500'
            )}
          >
            {summary || errors[0] || empty}
          </p>
        )}
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
                handle.id === 'true' ? '!bg-[#22c55e]' : '!bg-[#ef4444]'
              )}
            />
          ))}
          {!data.readOnly &&
            outgoing.map((handle, index) => (
              <button
                key={`add-${handle.id}`}
                type="button"
                className="nodrag nopan absolute -bottom-3 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-[#2f6fed] text-white opacity-0 shadow-md group-hover:opacity-100"
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
              className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-[#2f6fed] text-white opacity-0 shadow-md group-hover:opacity-100"
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


