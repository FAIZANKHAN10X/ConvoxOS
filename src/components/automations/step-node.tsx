'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, Trash2, Zap } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { resolveCatalogPorts } from '@/lib/automation/ports';
import {
  placeholderFor,
  previewText,
  summarizeNode,
} from '@/lib/automation/present';
import { cn } from '@/lib/utils';

import type { StepNodeData } from './graph-map';
import { CATEGORY_BADGE, CATEGORY_BAND, CATEGORY_ICON } from './kind-theme';

const HANDLE =
  '!h-3 !w-3 !border-2 !border-card !bg-muted-foreground/50';

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
  const outgoing = catalog
    ? resolveCatalogPorts(catalog, data.config).outgoing
    : [{ id: 'default', label: 'Next' }];
  const branched = outgoing.length > 1;
  const errors = data.errors ?? [];
  const summary = catalog
    ? summarizeNode(catalog, data.config, data.tagNames)
    : '';
  const empty = catalog
    ? placeholderFor(catalog, data.config)
    : 'Click to configure';
  const unconfigured = !summary;
  const badge = catalog ? CATEGORY_BADGE[catalog.category] : 'var(--primary)';
  const previewMessage =
    catalog && data.config
      ? previewText(catalog, data.config)
      : null;

  return (
    <div
      className={cn(
        'group relative w-[280px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-colors',
        selected
          ? 'border-primary ring-2 ring-primary/25 shadow-sm'
          : 'border-border/70 hover:border-border',
        errors.length > 0 && !selected && !isTrigger && 'border-destructive/60'
      )}
    >
      {/* 2px category accent — quiet hierarchy signal, not decoration */}
      <div
        className="h-[2px] w-full"
        style={{ backgroundColor: badge }}
      />

      {!isTrigger && catalog?.ports.incoming !== false && (
        <Handle
          type="target"
          position={Position.Left}
          className={HANDLE}
        />
      )}
      {!data.readOnly && !isTrigger && (
        <div className="absolute top-2 right-2 z-10 hidden gap-1 group-hover:flex">
          <button
            type="button"
            className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground hover:text-foreground shadow-xs transition-colors"
            onClick={(event) => {
              event.stopPropagation();
              data.onDuplicate?.(id);
            }}
            aria-label="Duplicate step"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-card text-destructive shadow-xs transition-colors hover:bg-destructive/10"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(id);
            }}
            aria-label="Delete step"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {isTrigger ? (
        <div className="p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <Zap className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            When…
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {summary ||
              'A trigger is an event that starts this automation.'}
          </p>
          <p className="mt-1.5 truncate text-sm font-semibold text-foreground">
            {catalog?.label ?? 'Trigger'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-2 border-b border-border/50 bg-muted/20">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
              style={{ background: badge }}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {catalog?.category ?? 'Action'}
              </p>
              <p className="truncate text-xs font-semibold text-foreground">
                {catalog?.label ?? data.nodeType}
              </p>
            </div>
          </div>
          <div className="px-3.5 py-2.5">
            {previewMessage ? (
              <div className="rounded-md bg-muted/50 border border-border/50 p-2">
                <p className="line-clamp-4 text-xs leading-relaxed text-foreground">
                  {previewMessage}
                </p>
              </div>
            ) : !branched ? (
              <p
                className={cn(
                  'line-clamp-3 text-xs leading-snug',
                  errors.length > 0 && !summary
                    ? 'text-destructive font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {summary || errors[0] || empty}
              </p>
            ) : null}
          </div>
        </>
      )}

      {branched ? (
        <div className="border-t border-border/50 divide-y divide-border/40 bg-muted/10">
          {outgoing.map((handle, index) => (
            <div
              key={handle.id}
              className="relative flex min-h-[38px] items-center px-3.5 py-1.5 pr-5 text-xs text-foreground/90"
            >
              <span className="min-w-0 flex-1 truncate">
                {handle.id === 'false'
                  ? "The contact doesn't match"
                  : handle.dynamic
                    ? handle.label
                    : summary || handle.label}
              </span>
              <Handle
                type="source"
                id={handle.id}
                position={Position.Right}
                onClick={(event) => {
                  event.stopPropagation();
                  if (data.readOnly) return;
                  data.onAddAfter?.(id, handle.id);
                }}
                style={{
                  top: `calc(100% - ${(outgoing.length - index) * 38 - 19}px)`,
                }}
                className={cn(
                  '!h-3 !w-3 !border-2 !border-card z-20 cursor-pointer',
                  handle.id === 'true'
                    ? '!bg-emerald-500'
                    : handle.id === 'false'
                      ? '!bg-rose-500'
                      : '!bg-muted-foreground/60'
                )}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <Handle
            type="source"
            id={outgoing[0]?.id === 'default' ? undefined : outgoing[0]?.id}
            position={Position.Right}
            onClick={(event) => {
              event.stopPropagation();
              if (data.readOnly) return;
              data.onAddAfter?.(id, outgoing[0]?.id);
            }}
            className={`${HANDLE} z-20 cursor-pointer`}
          />
          <span className="pointer-events-none absolute right-3 bottom-1.5 text-[10px] font-medium text-muted-foreground/70">
            {isTrigger ? 'Then' : 'Next Step'}
          </span>
        </>
      )}
    </div>
  );
}
