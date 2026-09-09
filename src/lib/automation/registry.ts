import type { NodeDefinition } from './types';

/**
 * Shared registry for builder discovery, publish validation, and
 * execution. Adding a node is: define it, implement execute/match,
 * register it. The engine never switches on node type.
 */
export class NodeRegistry {
  private readonly nodes = new Map<string, NodeDefinition>();

  register(definition: NodeDefinition): void {
    if (this.nodes.has(definition.type)) {
      throw new Error(`Duplicate node type "${definition.type}"`);
    }
    this.nodes.set(definition.type, definition);
  }

  get(type: string): NodeDefinition | undefined {
    return this.nodes.get(type);
  }

  require(type: string): NodeDefinition {
    const def = this.nodes.get(type);
    if (!def) {
      throw new Error(`Unknown node type "${type}"`);
    }
    return def;
  }

  list(): NodeDefinition[] {
    return [...this.nodes.values()];
  }

  listByCategory(): Map<NodeDefinition['category'], NodeDefinition[]> {
    const grouped = new Map<NodeDefinition['category'], NodeDefinition[]>();
    for (const def of this.nodes.values()) {
      const bucket = grouped.get(def.category) ?? [];
      bucket.push(def);
      grouped.set(def.category, bucket);
    }
    return grouped;
  }
}

export const defaultRegistry = new NodeRegistry();

export function registerNode(definition: NodeDefinition): void {
  defaultRegistry.register(definition);
}
