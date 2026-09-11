'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';

import type { CatalogBlock, CatalogNode, CatalogTask } from '@/lib/automation/catalog';
import { interpolationPathsForGraph } from '@/lib/automation/interpolate';
import { fieldsFromJsonSchema } from '@/lib/automation/schema-fields';
import type { AutomationGraph } from '@/lib/automation/types';
import { Button } from '@/components/ui/button';
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
  automationId?: string;
  nodeId?: string;
  graph?: AutomationGraph;
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
  automationId,
  nodeId,
  graph,
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
  const interpolationPaths = useMemo(
    () =>
      interpolationPathsForGraph(
        (graph?.nodes ?? []).map((node) => ({
          id: node.id,
          type: node.type,
          label: catalogList.find((entry) => entry.type === node.type)?.label,
        }))
      ),
    [catalogList, graph]
  );
  const [endpoints, setEndpoints] = useState<
    Array<{ id: string; name: string; url: string }>
  >([]);
  const [hook, setHook] = useState<{ id: string; url: string | null } | null>(
    null
  );
  const [testState, setTestState] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/integrations/endpoints')
      .then(async (response) => {
        const body = await response.json();
        if (!cancelled && response.ok) {
          setEndpoints(body.endpoints ?? []);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!automationId) return;
    let cancelled = false;
    void fetch(`/api/automations/${automationId}/hooks`)
      .then(async (response) => {
        const body = await response.json();
        if (!cancelled && response.ok) {
          setHook(body.hook ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  async function createEndpoint(input: { name: string; url: string }) {
    const response = await fetch('/api/integrations/endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) return null;
    const endpoint = body.endpoint as {
      id: string;
      name: string;
      url: string;
      secret?: string;
    };
    setEndpoints((current) => [endpoint, ...current]);
    return { id: endpoint.id, secret: endpoint.secret };
  }

  async function createOrRotateHook() {
    if (!automationId) return null;
    const response = await fetch(`/api/automations/${automationId}/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();
    if (!response.ok) return null;
    const created = body.hook as {
      id: string;
      url: string;
      secret: string;
    };
    setHook({ id: created.id, url: created.url });
    return created;
  }

  if (!catalog) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        This step is not in the node registry.
      </div>
    );
  }

  const Icon = CATEGORY_ICON[catalog.category];
  const accent = CATEGORY_ACCENT[catalog.category];

  return (
    <div className="flex h-full flex-col bg-card text-card-foreground">
      <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ background: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {catalog.label}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            {catalog.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {errors.filter((error) => !error.startsWith('Connect the')).length >
          0 && (
          <ul className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errors
              .filter((error) => !error.startsWith('Connect the'))
              .map((error) => (
                <li key={error}>{error}</li>
              ))}
          </ul>
        )}
        {catalog.kind === 'trigger' && onChangeType && (
          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select
              value={catalog.type}
              onValueChange={(value) => {
                if (value) onChangeType(value);
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
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
          if (field.name === catalog.blocksField && catalog.blocks) {
            return (
              <BlockListField
                key={field.name}
                blocks={catalog.blocks}
                value={config[field.name]}
                disabled={readOnly}
                tags={tags}
                interpolationPaths={interpolationPaths}
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
                interpolationPaths={interpolationPaths}
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
              interpolationPaths={interpolationPaths}
              endpoints={endpoints}
              hook={hook}
              onCreateEndpoint={createEndpoint}
              onCreateHook={createOrRotateHook}
              onRotateHook={createOrRotateHook}
              onChange={(next) => onChange({ ...config, [field.name]: next })}
            />
          );
        })}
        {catalog.flags?.testable && automationId && (
          <div className="space-y-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || testing}
              onClick={() => {
                setTesting(true);
                setTestState(null);
                void fetch(`/api/automations/${automationId}/test-node`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    nodeType: catalog.type,
                    nodeId,
                    config,
                  }),
                })
                  .then(async (response) => {
                    const body = await response.json();
                    setTestState(
                      JSON.stringify(body.result ?? body.error ?? body, null, 2)
                    );
                  })
                  .catch((error: unknown) => {
                    setTestState(
                      error instanceof Error ? error.message : 'Test failed'
                    );
                  })
                  .finally(() => setTesting(false));
              }}
            >
              {testing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              Test this step
            </Button>
            {testState && (
              <pre className="max-h-40 overflow-auto rounded-md border border-border/60 bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                {testState}
              </pre>
            )}
          </div>
        )}
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
    interpolationPaths?: Array<{ path: string; label: string }>;
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
      interpolationPaths={chrome.interpolationPaths}
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
  interpolationPaths,
  onChange,
}: {
  blocks: CatalogBlock[];
  value: unknown;
  disabled?: boolean;
  tags: Array<{ id: string; name: string }>;
  interpolationPaths?: Array<{ path: string; label: string }>;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const byType = new Map(blocks.map((block) => [block.blockType, block]));
  return (
    <div className="space-y-1.5">
      <Label>Content blocks</Label>
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
                interpolationPaths,
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
  interpolationPaths,
  onChange,
}: {
  tasks: CatalogTask[];
  value: unknown;
  disabled?: boolean;
  tags: Array<{ id: string; name: string }>;
  interpolationPaths?: Array<{ path: string; label: string }>;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const byType = new Map(tasks.map((task) => [task.taskType, task]));
  return (
    <div className="space-y-1.5">
      <Label>Actions</Label>
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
                interpolationPaths,
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
