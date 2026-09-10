'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';

import type { CatalogBlock, CatalogNode, CatalogTask } from '@/lib/automation/catalog';
import { fieldsFromJsonSchema } from '@/lib/automation/schema-fields';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CATEGORY_ACCENT, CATEGORY_ICON } from './kind-theme';
import { FieldInput, ItemListField } from './field-input';
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
        {errors.filter((error) => !error.startsWith('Connect the')).length >
          0 && (
          <ul className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {errors
              .filter((error) => !error.startsWith('Connect the'))
              .map((error) => (
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
              <SelectContent className="bg-white text-slate-800 ring-slate-200">
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
          if (field.name === catalog.blocksField && catalog.blocks) {
            return (
              <BlockListField
                key={field.name}
                blocks={catalog.blocks}
                value={config[field.name]}
                disabled={readOnly}
                tags={tags}
                onChange={(next) =>
                  onChange({ ...config, [field.name]: next })
                }
              />
            );
          }
          if (field.name === catalog.tasksField && catalog.tasks) {
            return (
              <TaskListField
                key={field.name}
                tasks={catalog.tasks}
                value={config[field.name]}
                disabled={readOnly}
                tags={tags}
                onChange={(next) =>
                  onChange({ ...config, [field.name]: next })
                }
              />
            );
          }
          return (
            <FieldInput
              key={field.name}
              field={field}
              value={config[field.name] ?? field.defaultValue ?? ''}
              values={config}
              disabled={readOnly}
              tags={tags}
              labels={catalog.fieldLabels}
              when={catalog.fieldWhen}
              onChange={(next) => onChange({ ...config, [field.name]: next })}
            />
          );
        })}
      </div>
    </div>
  );
}

function fieldInputsForSchema(
  jsonSchema: Record<string, unknown>,
  values: Record<string, unknown>,
  chrome: {
    disabled?: boolean;
    tags: Array<{ id: string; name: string }>;
    labels?: Record<string, Record<string, string>>;
    when?: Record<string, { field: string; values: string[] }>;
    onChange: (next: Record<string, unknown>) => void;
  }
) {
  return fieldsFromJsonSchema(jsonSchema).map((field) => (
    <FieldInput
      key={field.name}
      field={field}
      value={values[field.name]}
      values={values}
      disabled={chrome.disabled}
      tags={chrome.tags}
      labels={chrome.labels}
      when={chrome.when}
      onChange={(next) => chrome.onChange({ ...values, [field.name]: next })}
    />
    )
  );
}

/**
 * Registry-driven content-block list (message containers). Block
 * types, schemas, and labels all come from the catalog entry — no
 * per-node branches.
 */
function BlockListField({
  blocks,
  value,
  disabled,
  tags,
  onChange,
}: {
  blocks: CatalogBlock[];
  value: unknown;
  disabled?: boolean;
  tags: Array<{ id: string; name: string }>;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const byType = new Map(blocks.map((block) => [block.blockType, block]));
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-600">Content blocks</Label>
      <ItemListField
        items={items}
        typeKey="blockType"
        options={blocks.map((block) => ({
          value: block.blockType,
          label: block.label,
          description: block.description,
        }))}
        getTitle={(item, index) => {
          const block = typeof item.blockType === 'string'
            ? byType.get(item.blockType)
            : undefined;
          return block ? `${block.label} ${index + 1}` : `Block ${index + 1}`;
        }}
        renderConfig={(item, config, onConfigChange) => {
          const block =
            typeof item.blockType === 'string'
              ? byType.get(item.blockType)
              : undefined;
          if (!block) return null;
          return (
            <>
              {fieldInputsForSchema(block.jsonSchema, config, {
                disabled,
                tags,
                labels: block.fieldLabels,
                onChange: onConfigChange,
              })}
            </>
          );
        }}
        onChange={onChange}
        disabled={disabled}
        addPlaceholder="Choose a block"
        emptyText="No blocks yet. Add the first piece of content."
      />
    </div>
  );
}

/**
 * Registry-driven multi-action task list. Task types, schemas, and
 * labels all come from the catalog entry — no per-node branches.
 */
function TaskListField({
  tasks,
  value,
  disabled,
  tags,
  onChange,
}: {
  tasks: CatalogTask[];
  value: unknown;
  disabled?: boolean;
  tags: Array<{ id: string; name: string }>;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const byType = new Map(tasks.map((task) => [task.taskType, task]));
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-600">Actions</Label>
      <ItemListField
        items={items}
        typeKey="taskType"
        options={tasks.map((task) => ({
          value: task.taskType,
          label: task.label,
          description: task.description,
        }))}
        getTitle={(item, index) => {
          const task =
            typeof item.taskType === 'string'
              ? byType.get(item.taskType)
              : undefined;
          return task ? `${task.label} ${index + 1}` : `Action ${index + 1}`;
        }}
        renderConfig={(item, config, onConfigChange) => {
          const task =
            typeof item.taskType === 'string'
              ? byType.get(item.taskType)
              : undefined;
          if (!task) return null;
          return (
            <>
              {fieldInputsForSchema(task.jsonSchema, config, {
                disabled,
                tags,
                labels: task.fieldLabels,
                onChange: onConfigChange,
              })}
            </>
          );
        }}
        onChange={onChange}
        disabled={disabled}
        addPlaceholder="Choose an action"
        emptyText="No actions yet. Add the first one."
      />
    </div>
  );
}
