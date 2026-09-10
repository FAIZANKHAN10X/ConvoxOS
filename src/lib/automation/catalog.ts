import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { resolvePorts } from './ports';
import type { NodeRegistry } from './registry';
import type { NodeCategory, NodeHandleSpec, NodeKind } from './types';

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
    jsonSchema: zodToJsonSchema(def.configSchema, {
      target: 'openApi3',
      $refStrategy: 'none',
    }) as Record<string, unknown>,
  }));
}

export function catalogByType(
  catalog: CatalogNode[]
): Map<string, CatalogNode> {
  return new Map(catalog.map((node) => [node.type, node]));
}
