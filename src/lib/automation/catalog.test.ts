import { describe, expect, it } from 'vitest';

import { catalogFromRegistry } from './catalog';
import { defaultRegistry, NodeRegistry } from './registry';
import { fieldsFromJsonSchema } from './schema-fields';
import './nodes';

describe('automation catalog', () => {
  it('exposes every registered builtin without a hardcoded type list in the UI', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const types = catalog.map((node) => node.type).sort();
    expect(types).toEqual(
      [
        'action.add_tag',
        'action.send_text',
        'logic.condition',
        'timing.wait',
        'trigger.tag_added',
      ].sort()
    );
  });

  it('discovers builtins from the nodes/ folder without an engine switch', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    expect(catalog.every((node) => node.type.includes('.'))).toBe(true);
    expect(new Set(catalog.map((n) => n.kind)).size).toBeGreaterThan(1);
  });

  it('turns a newly registered node into a picker entry', () => {
    const registry = new NodeRegistry();
    registry.register({
      type: 'action.create_deal',
      kind: 'action',
      label: 'Create deal',
      description: 'Node 50',
      category: 'crm',
      configSchema: defaultRegistry.require('action.add_tag').configSchema,
    });
    expect(catalogFromRegistry(registry).map((n) => n.type)).toEqual([
      'action.create_deal',
    ]);
  });
});

describe('schema fields', () => {
  it('maps tagId to a CRM tag picker without switching on node type', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const trigger = catalog.find((n) => n.type === 'trigger.tag_added');
    const fields = fieldsFromJsonSchema(trigger?.jsonSchema);
    expect(fields.some((field) => field.type === 'tag')).toBe(true);
  });
});
