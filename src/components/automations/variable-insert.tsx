'use client';

import { Braces } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface InterpolationPath {
  path: string;
  label: string;
}

export function VariableInsert({
  paths,
  disabled,
  onInsert,
}: {
  paths: InterpolationPath[];
  disabled?: boolean;
  onInsert: (token: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <Braces className="h-3.5 w-3.5" />
        {'{{ }}'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 bg-card p-2 text-foreground">
        <PopoverHeader className="px-1 pb-1">
          <PopoverTitle className="text-xs text-muted-foreground">
            Insert a run variable
          </PopoverTitle>
        </PopoverHeader>
        <ul className="max-h-56 overflow-y-auto">
          {paths.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => onInsert(`{{${item.path}}}`)}
              >
                <span className="text-xs font-medium text-foreground">
                  {item.label}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {`{{${item.path}}}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
