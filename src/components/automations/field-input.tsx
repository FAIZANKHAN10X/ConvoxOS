'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';

import type { SchemaField } from '@/lib/automation/schema-fields';
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

export interface TagOption {
  id: string;
  name: string;
}

export interface FieldChrome {
  disabled?: boolean;
  tags: TagOption[];
  /** Human labels, keyed by field then raw value (registry fieldLabels). */
  labels?: Record<string, Record<string, string>>;
  /** Sibling values, for conditional (fieldWhen) visibility. */
  values?: Record<string, unknown>;
  when?: Record<string, { field: string; values: string[] }>;
}

/**
 * One schema-driven form field. Generic over any node/block/task —
 * never switches on node type. `labels`/`when` come from registry
 * metadata carried on the catalog entry.
 */
export function FieldInput({
  field,
  value,
  values = {},
  onChange,
  disabled,
  tags,
  labels,
  when,
}: FieldChrome & {
  field: SchemaField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.name === 'subject') return null;
  const rule = when?.[field.name];
  if (rule) {
    const current = String(values[rule.field] ?? '');
    if (!rule.values.includes(current)) return null;
  }
  const labelFor = (option: string) =>
    labels?.[field.name]?.[option] ?? option;

  if (field.type === 'stringList') {
    const list = Array.isArray(value)
      ? (value as string[]).join('\n')
      : typeof value === 'string'
        ? value
        : '';
    return (
      <div className="space-y-1.5">
        <Label className="text-slate-600">{field.label}</Label>
        <Textarea
          rows={4}
          value={list}
          disabled={disabled}
          className="border-slate-200 font-mono text-[13px]"
          placeholder="One per line"
          onChange={(event) =>
            onChange(
              event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            )
          }
        />
      </div>
    );
  }
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === 'tag') {
    return (
      <div className="space-y-1.5">
        <Label className="text-slate-600">{field.label}</Label>
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full border-slate-200">
            <SelectValue placeholder="Choose a tag" />
          </SelectTrigger>
          <SelectContent className="bg-white text-slate-800 ring-slate-200">
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
      <div className="space-y-1.5">
        <Label className="text-slate-600">{field.label}</Label>
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full border-slate-200">
            <SelectValue placeholder={`Choose ${field.label}`}>
              {typeof value === 'string' && value ? labelFor(value) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-white text-slate-800 ring-slate-200">
            {(field.enumValues ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {labelFor(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <div className="space-y-1.5">
        <Label className="text-slate-600">{field.label}</Label>
        <Input
          type="number"
          value={typeof value === 'number' ? value : ''}
          disabled={disabled}
          className="border-slate-200"
          onChange={(event) =>
            onChange(
              event.target.value ? Number(event.target.value) : undefined
            )
          }
        />
      </div>
    );
  }
  if (field.type === 'objectList') {
    return (
      <ObjectListField
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
        tags={tags}
        labels={labels}
        when={when}
      />
    );
  }
  if (field.name === 'text') {
    return (
      <div className="space-y-1.5">
        <Label className="text-slate-600">{field.label}</Label>
        <Textarea
          rows={5}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          className="border-slate-200 text-[15px] leading-relaxed"
          placeholder="Write the message…"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-600">{field.label}</Label>
      <Input
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        className="border-slate-200"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Generic array-of-objects editor (condition predicate rows, and any
 * future node config shaped the same way). Rows render through
 * FieldInput, so labels and conditional visibility stay metadata-driven.
 */
export function ObjectListField({
  field,
  value,
  onChange,
  disabled,
  tags,
  labels,
  when,
  rowTitle,
}: FieldChrome & {
  field: SchemaField;
  value: unknown;
  onChange: (value: unknown) => void;
  rowTitle?: (row: Record<string, unknown>, index: number) => string;
}) {
  const rows = Array.isArray(value) ? value : [];
  const itemFields = field.itemFields ?? [];
  const update = (next: unknown[]) => onChange(next);
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    update(next);
  };

  return (
    <div className="space-y-2">
      <Label className="text-slate-600">{field.label}</Label>
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
          No {field.label.toLowerCase()} yet.
        </p>
      )}
      {rows.map((row, index) => {
        const values = asRecord(row);
        return (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
          >
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-semibold text-slate-500">
                {rowTitle
                  ? rowTitle(values, index)
                  : `${field.label} ${index + 1}`}
              </p>
              <RowActions
                disabled={disabled}
                canMoveUp={index > 0}
                canMoveDown={index < rows.length - 1}
                canDuplicate={false}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onRemove={() => update(rows.filter((_, i) => i !== index))}
              />
            </div>
            {itemFields.map((itemField) => (
              <FieldInput
                key={itemField.name}
                field={itemField}
                value={values[itemField.name]}
                values={values}
                disabled={disabled}
                tags={tags}
                labels={labels}
                when={when}
                onChange={(next) =>
                  update(
                    rows.map((r, i) =>
                      i === index
                        ? { ...asRecord(r), [itemField.name]: next }
                        : r
                    )
                  )
                }
              />
            ))}
          </div>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={() => update([...rows, {}])}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-[#2f6fed] hover:text-[#2f6fed] disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {field.label.toLowerCase()}
      </button>
    </div>
  );
}

function RowActions({
  disabled,
  canMoveUp,
  canMoveDown,
  canDuplicate,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDuplicate: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
}) {
  const btn =
    'rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30';
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || !canMoveUp}
        aria-label="Move up"
        className={btn}
        onClick={onMoveUp}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled || !canMoveDown}
        aria-label="Move down"
        className={btn}
        onClick={onMoveDown}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      {canDuplicate && (
        <button
          type="button"
          disabled={disabled}
          aria-label="Duplicate"
          className={btn}
          onClick={onDuplicate}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label="Remove"
        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export interface ItemOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Generic identified-item list with a typed picker: content blocks
 * (blockType) and multi-action tasks (taskType) share this shape.
 * Items carry `{id, <typeKey>, config}`; per-item config renders
 * through the caller-provided `renderConfig`.
 */
export function ItemListField({
  items,
  options,
  typeKey,
  getTitle,
  renderConfig,
  onChange,
  disabled,
  addPlaceholder,
  emptyText,
}: {
  items: Array<Record<string, unknown>>;
  options: ItemOption[];
  /** Discriminator key holding the block/task type id. */
  typeKey: string;
  getTitle: (item: Record<string, unknown>, index: number) => string;
  renderConfig: (
    item: Record<string, unknown>,
    config: Record<string, unknown>,
    onConfigChange: (config: Record<string, unknown>) => void
  ) => React.ReactNode;
  onChange: (items: Array<Record<string, unknown>>) => void;
  disabled?: boolean;
  addPlaceholder: string;
  emptyText: string;
}) {
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    onChange(next);
  };
  const duplicate = (index: number) => {
    const source = items[index];
    const copy = {
      ...(JSON.parse(JSON.stringify(source)) as Record<string, unknown>),
      id: crypto.randomUUID(),
    };
    const next = [...items];
    next.splice(index + 1, 0, copy);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
          {emptyText}
        </p>
      )}
      {items.map((item, index) => (
        <div
          key={typeof item.id === 'string' ? item.id : index}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-xs font-semibold text-slate-600">
              {getTitle(item, index)}
            </p>
            <RowActions
              disabled={disabled}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              canDuplicate
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onDuplicate={() => duplicate(index)}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          </div>
          {renderConfig(item, asRecord(item.config), (config) =>
            onChange(
              items.map((row, i) => (i === index ? { ...row, config } : row))
            )
          )}
        </div>
      ))}
      {options.length > 0 && (
        <TypePicker
          options={options}
          disabled={disabled}
          placeholder={addPlaceholder}
          onPick={(value) =>
            onChange([...items, { id: crypto.randomUUID(), [typeKey]: value, config: {} }])
          }
        />
      )}
    </div>
  );
}

function TypePicker({
  options,
  disabled,
  placeholder,
  onPick,
}: {
  options: ItemOption[];
  disabled?: boolean;
  placeholder: string;
  onPick: (value: string) => void;
}) {
  const [value, setValue] = React.useState('');
  return (
    <>
      <Select
        value={value}
        onValueChange={(next) => setValue(next ?? '')}
        disabled={disabled}
      >
        <SelectTrigger className="w-full border-slate-200">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-white text-slate-800 ring-slate-200">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        disabled={disabled || !value}
        onClick={() => {
          onPick(value);
          setValue('');
        }}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#2f6fed] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2559c4] disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </button>
    </>
  );
}
