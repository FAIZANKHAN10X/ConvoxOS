import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { resolvePorts } from './ports';
import type { NodeRegistry } from './registry';
import type {
  BlockDefinition,
  DynamicPortRule,
  NodeCategory,
  NodeFlags,
  NodeHandleSpec,
  NodeKind,
  TaskHandlerDef,
} from './types';

function configDefaultsFromSchema(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>
): Record<string, unknown> {
  const parsed = schema.safeParse({});
  if (
    parsed.success &&
    parsed.data &&
    typeof parsed.data === 'object' &&
    !Array.isArray(parsed.data)
  ) {
    return { ...(parsed.data as Record<string, unknown>) };
  }
  return {};
}

export interface CatalogBlock {
  blockType: string;
  label: string;
  description?: string;
  jsonSchema: Record<string, unknown>;
  fieldLabels?: Record<string, Record<string, string>>;
  emptyPrompt?: string;
  preview?: boolean;
}

export interface CatalogTask {
  taskType: string;
  label: string;
  description?: string;
  jsonSchema: Record<string, unknown>;
  fieldLabels?: Record<string, Record<string, string>>;
}

function toJsonSchema(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>
): Record<string, unknown> {
  return zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

function serializeBlocks(
  blocks: BlockDefinition[] | undefined
): CatalogBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((block) => ({
    blockType: block.blockType,
    label: block.label,
    description: block.description,
    jsonSchema: toJsonSchema(block.configSchema),
    fieldLabels: block.fieldLabels,
    emptyPrompt: block.emptyPrompt,
    preview: block.preview,
  }));
}

function serializeTasks(
  tasks: TaskHandlerDef[] | undefined
): CatalogTask[] | undefined {
  if (!tasks) return undefined;
  return tasks.map((task) => ({
    taskType: task.taskType,
    label: task.label,
    description: task.description,
    jsonSchema: toJsonSchema(task.configSchema),
    fieldLabels: task.fieldLabels,
  }));
}

export interface CatalogNode {
  type: string;
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  jsonSchema: Record<string, unknown>;
  preview?: 'message';
  fieldLabels?: Record<string, Record<string, string>>;
  emptyPrompt?: string;
  fieldWhen?: Record<string, { field: string; values: string[] }>;
  /** Zod defaults, so empty stored config still displays honestly. */
  configDefaults?: Record<string, unknown>;
  blocks?: CatalogBlock[];
  /** Config key holding the BlockInstance array. Defaults to `blocks`. */
  blocksField?: string;
  tasks?: CatalogTask[];
  /** Config key holding the TaskItem array. Defaults to `tasks`. */
  tasksField?: string;
  flags?: NodeFlags;
  /**
   * Declarative dynamic-port rule for canvas rendering. True when the
   * definition also carries an `outputsFor` function (which cannot be
   * serialized and stays server-side for validation).
   */
  dynamicPorts?: DynamicPortRule;
  ports: {
    incoming: boolean;
    outgoing: NodeHandleSpec[];
  };
}

export function catalogFromRegistry(registry: NodeRegistry): CatalogNode[] {
  return registry.list().map((def) => ({
    type: def.type,
    kind: def.kind,
    label: def.label,
    description: def.description,
    category: def.category,
    ports: resolvePorts(def),
    preview: def.preview,
    fieldLabels: def.fieldLabels,
    emptyPrompt: def.emptyPrompt,
    fieldWhen: def.fieldWhen,
    configDefaults: configDefaultsFromSchema(def.configSchema),
    blocks: serializeBlocks(def.blocks),
    blocksField: def.blocks ? (def.blockField ?? 'blocks') : undefined,
    tasks: serializeTasks(def.tasks),
    tasksField: def.tasks ? (def.taskField ?? 'tasks') : undefined,
    flags: def.flags,
    dynamicPorts: def.dynamicPorts ?? (def.outputsFor ? {} : undefined),
    jsonSchema: toJsonSchema(def.configSchema),
  }));
}

export function catalogByType(
  catalog: CatalogNode[]
): Map<string, CatalogNode> {
  return new Map(catalog.map((node) => [node.type, node]));
}
