'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { createClient } from '@/lib/supabase/client';

import { CATEGORY_ACCENT, CATEGORY_ICON } from './kind-theme';

interface ConfigPanelProps {
  catalog: CatalogNode | undefined;
  config: Record<string, unknown>;
  errors: string[];
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
  onClose: () => void;
}

export function ConfigPanel({
  catalog,
  config,
  errors,
  readOnly,
  onChange,
  onClose,
}: ConfigPanelProps) {
  const fields = useMemo(
    () => (catalog ? fieldsFromJsonSchema(catalog.jsonSchema) : []),
    [catalog]
  );
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!fields.some((field) => field.type === 'tag')) return;
    const supabase = createClient();
    void supabase
      .from('tags')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        setTags((data as Array<{ id: string; name: string }>) ?? []);
      });
  }, [fields]);

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
        {fields.map((field) => {
          const value = config[field.name] ?? field.defaultValue ?? '';
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
                    <SelectValue placeholder={`Choose ${field.label}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.enumValues ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
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
