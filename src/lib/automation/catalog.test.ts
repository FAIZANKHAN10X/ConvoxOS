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
        'action.remove_tag',
        'action.send_text',
        'logic.condition',
        'timing.wait',
        'trigger.contact_created',
        'trigger.keyword',
        'trigger.message_received',
        'trigger.tag_added',
        'trigger.tag_removed',
      ].sort()
    );
    expect(catalog.every((node) => node.ports.outgoing.length >= 1)).toBe(true);
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
    const created = catalogFromRegistry(registry)[0];
    expect(created?.type).toBe('action.create_deal');
    expect(created?.ports.incoming).toBe(true);
    expect(created?.ports.outgoing.map((handle) => handle.id)).toEqual([
      'default',
    ]);
    expect(created?.label).toBe('Create deal');
    expect(created?.category).toBe('crm');
  });
});

describe('schema fields', () => {
  it('maps tagId to a CRM tag picker without switching on node type', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const trigger = catalog.find((n) => n.type === 'trigger.tag_added');
    const fields = fieldsFromJsonSchema(trigger?.jsonSchema);
    expect(fields.some((field) => field.type === 'tag')).toBe(true);
  });

  it('maps keyword lists to a stringList field without a node-type switch', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const keyword = catalog.find((n) => n.type === 'trigger.keyword');
    const fields = fieldsFromJsonSchema(keyword?.jsonSchema);
    expect(fields.some((field) => field.type === 'stringList')).toBe(true);
  });
});
