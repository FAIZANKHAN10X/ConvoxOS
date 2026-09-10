'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, Plus, Trash2, Zap } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { placeholderFor, summarizeNode } from '@/lib/automation/present';
import { cn } from '@/lib/utils';

import type { StepNodeData } from './graph-map';
import { CATEGORY_BADGE, CATEGORY_BAND, CATEGORY_ICON } from './kind-theme';

const HANDLE =
  '!h-3 !w-3 !border-2 !border-white !bg-[#c5ced8]';

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
  const band = catalog ? CATEGORY_BAND[catalog.category] : '#ffffff';
  const badge = catalog ? CATEGORY_BADGE[catalog.category] : '#2f6fed';
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
        selected
          ? 'border-transparent ring-2 ring-[#22c55e]'
          : 'border-slate-200',
        unconfigured && !selected && isTrigger && 'border-slate-200',
        errors.length > 0 && !selected && !isTrigger && 'border-red-300'
      )}
    >
      {!isTrigger && catalog?.ports.incoming !== false && (
        <Handle
          type="target"
          position={Position.Left}
          className={HANDLE}
        />
      )}
      {!data.readOnly && !isTrigger && (
        <div className="absolute -top-3 right-2 z-10 hidden gap-1 group-hover:flex">
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

      {isTrigger ? (
        <div className="px-5 py-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <Zap className="h-3.5 w-3.5 text-slate-700" />
            When…
          </p>
          <p className="mt-2 text-[13px] leading-snug text-slate-500">
            {summary ||
              'A trigger is an event that starts this automation.'}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold text-slate-900">
            {catalog?.label ?? 'Trigger'}
          </p>
        </div>
      ) : (
        <>
          <div
            className="flex items-center gap-2 rounded-t-[17px] px-4 pt-3 pb-2.5"
            style={{ background: band }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: badge }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              {catalog?.category === 'communication' && (
                <p className="truncate text-[11px] text-slate-400">Message</p>
              )}
              <p className="truncate text-[14px] font-semibold text-slate-900">
                {catalog?.label ?? data.nodeType}
              </p>
            </div>
          </div>
          <div className="px-4 pt-2 pb-3">
            {previewMessage ? (
              <div className="rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2">
                <p className="line-clamp-4 text-[13px] leading-snug text-slate-700">
                  {previewMessage}
                </p>
              </div>
            ) : !branched ? (
              <p
                className={cn(
                  'line-clamp-3 text-[13px] leading-snug',
                  errors.length > 0 && !summary
                    ? 'text-red-500'
                    : 'text-slate-500'
                )}
              >
                {summary || errors[0] || empty}
              </p>
            ) : null}
          </div>
        </>
      )}

      {branched ? (
        <div className="border-t border-slate-100">
          {outgoing.map((handle, index) => (
            <div
              key={handle.id}
              className="relative flex min-h-[44px] items-center px-4 py-2 pr-5 text-[12px] leading-snug text-slate-600"
            >
              <span className="min-w-0 flex-1">
                {handle.id === 'false'
                  ? "The contact doesn't match"
                  : summary || handle.label}
              </span>
              <Handle
                type="source"
                id={handle.id}
                position={Position.Right}
                style={{
                  top: `calc(100% - ${(outgoing.length - index) * 44 - 22}px)`,
                }}
                className={cn(
                  '!h-3 !w-3 !border-2 !border-white',
                  handle.id === 'true' ? '!bg-[#22c55e]' : '!bg-[#ef4444]'
                )}
              />
              {!data.readOnly && (
                <button
                  type="button"
                  className="nodrag nopan absolute -right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#2f6fed] text-white opacity-0 shadow-md group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onAddAfter?.(id, handle.id);
                  }}
                  aria-label={`Add ${handle.label} step`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <Handle
            type="source"
            id={outgoing[0]?.id === 'default' ? undefined : outgoing[0]?.id}
            position={Position.Right}
            className={HANDLE}
          />
          <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-slate-400">
            {isTrigger ? 'Then' : 'Next Step'}
          </span>
          {!data.readOnly && (
            <button
              type="button"
              className="nodrag nopan absolute top-1/2 -right-3 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#2f6fed] text-white opacity-0 shadow-md group-hover:opacity-100"
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
