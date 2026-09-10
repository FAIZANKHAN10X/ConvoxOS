'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { fieldsFromJsonSchema } from '@/lib/automation/schema-fields';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { CATEGORY_ACCENT, CATEGORY_ICON } from './kind-theme';
import { useTagNames } from './use-tags';

interface ConfigPanelProps {
  catalog: CatalogNode | undefined;
  catalogList?: CatalogNode[];
  config: Record<string, unknown>;
  errors: string[];
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
  onChangeType?: (type: string) => void;
  onClose: () => void;
}

export function ConfigPanel({
  catalog,
  catalogList = [],
  config,
  errors,
  readOnly,
  onChange,
  onChangeType,
  onClose,
}: ConfigPanelProps) {
  const fields = useMemo(
    () => (catalog ? fieldsFromJsonSchema(catalog.jsonSchema) : []),
    [catalog]
  );
  const tagNames = useTagNames();
  const tags = useMemo(
    () => Object.entries(tagNames).map(([id, name]) => ({ id, name })),
    [tagNames]
  );

  if (!catalog) {
    return (
      <div className="p-5 text-sm text-slate-500">
        This step is not in the node registry.
      </div>
    );
  }

  const Icon = CATEGORY_ICON[catalog.category];
  const accent = CATEGORY_ACCENT[catalog.category];

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-800">
            {catalog.label}
          </p>
          <p className="text-xs leading-snug text-slate-500">
            {catalog.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {errors.length > 0 && (
          <ul className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {catalog.kind === 'trigger' && onChangeType && (
          <div className="space-y-1.5">
            <Label className="text-slate-600">Trigger</Label>
            <Select
              value={catalog.type}
              onValueChange={(value) => {
                if (value) onChangeType(value);
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full border-slate-200">
                <SelectValue>{catalog.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {catalogList
                  .filter((node) => node.kind === 'trigger')
                  .map((node) => (
                    <SelectItem key={node.type} value={node.type}>
                      {node.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {fields.map((field) => {
          if (field.name === 'subject') return null;
          const value = config[field.name] ?? field.defaultValue ?? '';
          if (field.type === 'stringList') {
            const list = Array.isArray(value)
              ? (value as string[]).join('\n')
              : typeof value === 'string'
                ? value
                : '';
            return (
              <div key={field.name} className="space-y-1.5">
                <Label className="text-slate-600">{field.label}</Label>
                <Textarea
                  rows={4}
                  value={list}
                  disabled={readOnly}
                  className="border-slate-200 font-mono text-[13px]"
                  placeholder="One keyword per line"
                  onChange={(event) =>
                    onChange({
                      ...config,
                      [field.name]: event.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            );
          }
          if (field.type === 'boolean') {
            return (
              <label
                key={field.name}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange({ ...config, [field.name]: event.target.checked })
                  }
                />
                {field.label}
              </label>
            );
          }
          if (field.type === 'tag') {
            return (
              <div key={field.name} className="space-y-1.5">
                <Label className="text-slate-600">{field.label}</Label>
                <Select
                  value={typeof value === 'string' ? value : ''}
                  onValueChange={(next) =>
                    onChange({ ...config, [field.name]: next })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full border-slate-200">
                    <SelectValue placeholder="Choose a tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          if (field.type === 'enum') {
            return (
              <div key={field.name} className="space-y-1.5">
                <Label className="text-slate-600">{field.label}</Label>
                <Select
                  value={typeof value === 'string' ? value : ''}
                  onValueChange={(next) =>
                    onChange({ ...config, [field.name]: next })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full border-slate-200">
                    <SelectValue placeholder={`Choose ${field.label}`}>
                      {typeof value === 'string' && value
                        ? (catalog.fieldLabels?.[field.name]?.[value] ?? value)
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(field.enumValues ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {catalog.fieldLabels?.[field.name]?.[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          if (field.type === 'number') {
            return (
              <div key={field.name} className="space-y-1.5">
                <Label className="text-slate-600">{field.label}</Label>
                <Input
                  type="number"
                  value={typeof value === 'number' ? value : ''}
                  disabled={readOnly}
                  className="border-slate-200"
                  onChange={(event) =>
                    onChange({
                      ...config,
                      [field.name]: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              </div>
            );
          }
          if (field.name === 'text') {
            return (
              <div key={field.name} className="space-y-1.5">
                <Label className="text-slate-600">{field.label}</Label>
                <Textarea
                  rows={5}
                  value={typeof value === 'string' ? value : ''}
                  disabled={readOnly}
                  className="border-slate-200 text-[15px] leading-relaxed"
                  placeholder="Write the message…"
                  onChange={(event) =>
                    onChange({ ...config, [field.name]: event.target.value })
                  }
                />
              </div>
            );
          }
          return (
            <div key={field.name} className="space-y-1.5">
              <Label className="text-slate-600">{field.label}</Label>
              <Input
                value={typeof value === 'string' ? value : ''}
                disabled={readOnly}
                className="border-slate-200"
                onChange={(event) =>
                  onChange({ ...config, [field.name]: event.target.value })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
