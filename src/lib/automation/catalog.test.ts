import { describe, expect, it } from 'vitest';

import { catalogFromRegistry } from './catalog';
import { defaultRegistry, NodeRegistry } from './registry';
import { fieldsFromJsonSchema } from './schema-fields';
import './nodes/index';

describe('automation catalog', () => {
  it('exposes every registered builtin without a hardcoded type list in the UI', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const types = catalog.map((node) => node.type).sort();
    expect(types).toEqual(
      [
        'action.add_tag',
        'action.assign_owner',
        'action.complete_task',
        'action.create_deal',
        'action.create_note',
        'action.create_task',
        'action.http_request',
        'action.move_deal',
        'action.n8n_workflow',
        'action.remove_tag',
        'action.send_text',
        'action.set_deal_status',
        'action.update_contact',
        'action.update_deal',
        'logic.condition',
        'message.send',
        'timing.wait',
        'wait.external',
        'trigger.contact_created',
        'trigger.contact_updated',
        'trigger.deal_created',
        'trigger.deal_lost',
        'trigger.deal_stage_changed',
        'trigger.deal_status_changed',
        'trigger.deal_won',
        'trigger.inbound_webhook',
        'trigger.keyword',
        'trigger.message_received',
        'trigger.note_added',
        'trigger.tag_added',
        'trigger.tag_removed',
        'trigger.task_completed',
        'trigger.task_created',
        'trigger.task_overdue',
      ].sort()
    );
    expect(catalog.every((node) => node.ports.outgoing.length >= 1)).toBe(true);
    expect(
      catalog.find((node) => node.type === 'action.http_request')?.category
    ).toBe('integration');
    expect(
      catalog.find((node) => node.type === 'action.n8n_workflow')?.category
    ).toBe('integration');
    expect(
      catalog.find((node) => node.type === 'logic.condition')?.category
    ).toBe('logic');
    expect(
      catalog.find((node) => node.type === 'wait.external')?.category
    ).toBe('integration');
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

  it('copies fieldWhen so editors can hide irrelevant fields without a type switch', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const condition = catalog.find((node) => node.type === 'logic.condition');
    expect(condition?.fieldWhen?.tagId?.values).toContain('has_tag');
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

  it('maps endpointId and hookId to pickers without a node-type switch', () => {
    const catalog = catalogFromRegistry(defaultRegistry);
    const n8n = catalog.find((n) => n.type === 'action.n8n_workflow');
    const hook = catalog.find((n) => n.type === 'trigger.inbound_webhook');
    expect(
      fieldsFromJsonSchema(n8n?.jsonSchema).some(
        (field) => field.type === 'integrationEndpoint'
      )
    ).toBe(true);
    expect(
      fieldsFromJsonSchema(hook?.jsonSchema).some(
        (field) => field.type === 'inboundHook'
      )
    ).toBe(true);
  });
});
