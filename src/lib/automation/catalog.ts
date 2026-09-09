import { zodToJsonSchema } from 'zod-to-json-schema';

import { resolvePorts } from './ports';
import type { NodeRegistry } from './registry';
import type { NodeCategory, NodeHandleSpec, NodeKind } from './types';

export interface CatalogNode {
  type: string;
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  jsonSchema: Record<string, unknown>;
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
