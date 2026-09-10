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

/**
 * One output handle per item of a config array field (randomizer
 * variants, button rows). Falls back to the base ports when the field
 * is missing or empty so unconfigured nodes still render one handle.
 */
export function resolvePortsForConfig(
  base: NodePorts,
  rule: DynamicPortRule | undefined,
  config: Record<string, unknown>
): NodePorts {
  if (!rule?.field) return base;
  const raw = config[rule.field];
  if (!Array.isArray(raw)) return base;
  const idField = rule.idField ?? 'id';
  const labelField = rule.labelField ?? 'label';
  const outgoing = raw.map((item, index) => {
    const row =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : {};
    const id = row[idField];
    const label = row[labelField];
    return {
      id: typeof id === 'string' && id ? id : `item-${index}`,
      label:
        typeof label === 'string' && label ? label : `Option ${index + 1}`,
    };
  });
  if (outgoing.length === 0) return base;
  return { incoming: base.incoming, outgoing };
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
