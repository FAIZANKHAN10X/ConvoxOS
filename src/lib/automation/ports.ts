import type {
  DynamicPortRule,
  NodeDefinition,
  NodeHandleSpec,
  NodeKind,
  NodePorts,
} from './types';

export const NEXT_HANDLE: NodeHandleSpec = { id: 'default', label: 'Next' };
export const YES_HANDLE: NodeHandleSpec = { id: 'true', label: 'Yes' };
export const NO_HANDLE: NodeHandleSpec = { id: 'false', label: 'No' };

export function defaultPorts(kind: NodeKind): NodePorts {
  if (kind === 'trigger') {
    return { incoming: false, outgoing: [NEXT_HANDLE] };
  }
  if (kind === 'condition') {
    return { incoming: true, outgoing: [YES_HANDLE, NO_HANDLE] };
  }
  return { incoming: true, outgoing: [NEXT_HANDLE] };
}

export function resolvePorts(def: {
  kind: NodeKind;
  ports?: NodePorts;
}): NodePorts {
  return def.ports ?? defaultPorts(def.kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPath(
  root: Record<string, unknown>,
  path: string
): unknown {
  let current: unknown = root;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Collect the rows a dynamic-port rule generates handles for:
 * top-level array items, optionally filtered to one block type,
 * optionally descending into a nested rows array, optionally
 * skipping rows (e.g. URL buttons, which leave the flow).
 */
function collectPortRows(
  rule: DynamicPortRule,
  config: Record<string, unknown>
): Array<Record<string, unknown>> {
  if (!rule.field) return [];
  const raw = config[rule.field];
  if (!Array.isArray(raw)) return [];
  let items = raw.filter(isRecord);
  if (rule.match) {
    items = items.filter((item) => item[rule.match!.field] === rule.match!.equals);
  }
  if (rule.itemsField) {
    const nested: Array<Record<string, unknown>> = [];
    for (const item of items) {
      // itemsField may address the row array directly (variants) or
      // nested inside each item's config (button rows in blocks).
      const sub = rule.itemsField.includes('.')
        ? readPath(item, rule.itemsField)
        : item[rule.itemsField];
      if (Array.isArray(sub)) nested.push(...sub.filter(isRecord));
    }
    items = nested;
  }
  if (rule.skipWhen) {
    const { field, present } = rule.skipWhen;
    items = items.filter((item) => isPresent(item[field]) !== present);
  }
  return items;
}

/**
 * Handles generated from node config, or null when the rule does not
 * apply (missing/empty source). Null falls back to base ports so
 * unconfigured nodes still render one handle.
 */
export function dynamicHandles(
  rule: DynamicPortRule | undefined,
  config: Record<string, unknown>
): NodeHandleSpec[] | null {
  if (!rule?.field) return null;
  const rows = collectPortRows(rule, config);
  if (rows.length === 0) return null;
  const idField = rule.idField ?? 'id';
  const labelField = rule.labelField ?? 'label';
  return rows.map((row, index) => {
    const id = row[idField];
    const label = row[labelField];
    return {
      id: typeof id === 'string' && id ? id : `item-${index}`,
      label:
        typeof label === 'string' && label ? label : `Option ${index + 1}`,
      dynamic: true,
    };
  });
}

/**
 * One output handle per matching config row. Falls back to the base
 * ports when the rule does not apply so unconfigured nodes still
 * render one handle. With `keepBase`, generated handles append after
 * the static ones (message Next + button branches).
 */
export function resolvePortsForConfig(
  base: NodePorts,
  rule: DynamicPortRule | undefined,
  config: Record<string, unknown>
): NodePorts {
  const dynamic = dynamicHandles(rule, config);
  if (!dynamic) return base;
  if (rule?.keepBase) {
    return { incoming: base.incoming, outgoing: [...base.outgoing, ...dynamic] };
  }
  return { incoming: base.incoming, outgoing: dynamic };
}

/**
 * Server-side port resolution for a node definition + parsed config.
 * The `outputsFor` function wins when present; otherwise the
 * declarative rule; otherwise static ports. The engine itself stays
 * handle-agnostic (nextNodeId matches edge sourceHandles directly).
 */
export function resolveDefPorts(
  def: Pick<NodeDefinition, 'kind' | 'ports' | 'outputsFor' | 'dynamicPorts'>,
  config?: Record<string, unknown>
): NodePorts {
  const base = resolvePorts(def);
  if (!config) return base;
  if (def.outputsFor) {
    try {
      return def.outputsFor(config as never);
    } catch {
      return base;
    }
  }
  return resolvePortsForConfig(base, def.dynamicPorts, config);
}

/**
 * Client-safe port resolution from catalog data + node config. The
 * canvas renders dynamic handles (randomizer variants, button rows)
 * without importing node definitions or switching on type.
 */
export function resolveCatalogPorts(
  catalog: { ports: NodePorts; dynamicPorts?: DynamicPortRule },
  config: Record<string, unknown>
): NodePorts {
  return resolvePortsForConfig(catalog.ports, catalog.dynamicPorts, config);
}
