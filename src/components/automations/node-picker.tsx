'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { CATEGORY_ACCENT, CATEGORY_ICON, CATEGORY_LABEL } from './kind-theme';

interface NodePickerProps {
  catalog: CatalogNode[];
  allowTriggers: boolean;
  onPick: (node: CatalogNode) => void;
}

export function NodePicker({
  catalog,
  allowTriggers,
  onPick,
}: NodePickerProps) {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = catalog.filter((node) => {
      if (!allowTriggers && node.kind === 'trigger') return false;
      if (!q) return true;
      return (
        node.label.toLowerCase().includes(q) ||
        node.description.toLowerCase().includes(q) ||
        node.type.toLowerCase().includes(q) ||
        node.category.toLowerCase().includes(q)
      );
    });
    // Fixed section order keeps the picker stable as nodes are added:
    // triggers first when the canvas has none (trigger-first creation),
    // then message content, CRM actions, branching logic, timing.
    const order: CatalogNode['category'][] = allowTriggers
      ? ['trigger', 'communication', 'crm', 'logic', 'timing']
      : ['communication', 'crm', 'logic', 'timing', 'trigger'];
    const map = new Map<CatalogNode['category'], CatalogNode[]>();
    for (const category of order) map.set(category, []);
    for (const node of filtered) {
      map.get(node.category)?.push(node);
    }
    for (const [category, nodes] of [...map.entries()]) {
      if (nodes.length === 0) map.delete(category);
    }
    return map;
  }, [allowTriggers, catalog, query]);

  return (
    <div className="flex w-[340px] flex-col gap-3">
      <div>
        <p className="text-[15px] font-semibold text-slate-800">
          {allowTriggers ? 'Choose how it starts' : 'Add a step'}
        </p>
        <p className="text-xs text-slate-500">
          {allowTriggers
            ? 'Pick a trigger — every automation starts with one.'
            : 'Search or pick a block for this automation.'}
        </p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search blocks"
          className="h-9 border-slate-200 bg-slate-50 pl-8 text-slate-800"
          autoFocus
        />
      </div>
      <div className="max-h-[420px] overflow-y-auto pr-1">
        {[...grouped.entries()].map(([category, nodes]) => {
          const Icon = CATEGORY_ICON[category];
          return (
            <div key={category} className="mb-4">
              <p className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                <Icon className="h-3 w-3" />
                {CATEGORY_LABEL[category]}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {nodes.map((node) => {
                  const NodeIcon = CATEGORY_ICON[node.category];
                  return (
                    <button
                      key={node.type}
                      type="button"
                      onClick={() => onPick(node)}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border border-transparent bg-slate-50 px-3 py-2.5 text-left hover:border-slate-200 hover:bg-white hover:shadow-sm'
                      )}
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ background: CATEGORY_ACCENT[node.category] }}
                      >
                        <NodeIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">
                          {node.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                          {node.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {grouped.size === 0 && (
          <p className="px-2 py-8 text-center text-xs text-slate-500">
            No steps match that search.
          </p>
        )}
      </div>
    </div>
  );
}
