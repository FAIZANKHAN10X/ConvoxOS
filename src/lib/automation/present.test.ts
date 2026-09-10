import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { catalogFromRegistry } from './catalog';
import './nodes';
import {
  defaultsFromCatalog,
  placeholderFor,
  summarizeNode,
} from './present';
import { defaultRegistry, NodeRegistry } from './registry';
import { fieldsFromJsonSchema } from './schema-fields';

describe('catalog presentation', () => {
  it('summarizes the starter message-received trigger from schema defaults', () => {
    const catalog = catalogFromRegistry(defaultRegistry).find(
      (node) => node.type === 'trigger.message_received'
    );
    expect(catalog).toBeDefined();
    expect(summarizeNode(catalog!, {})).toBe('Any channel');
    expect(placeholderFor(catalog!, {})).toBe('Choose how it starts');
  });

  it('uses predicate labels instead of raw ids', () => {
    const catalog = catalogFromRegistry(defaultRegistry).find(
      (node) => node.type === 'logic.condition'
    );
    expect(catalog?.fieldLabels?.predicate?.['event.text']).toBe(
      'Message text'
    );
    expect(
      summarizeNode(catalog!, { predicate: 'event.text', op: 'contains' })
    ).toBe('Message text');
  });

  it('renders send_text as the message body', () => {
    const catalog = catalogFromRegistry(defaultRegistry).find(
      (node) => node.type === 'action.send_text'
    );
    expect(catalog?.preview).toBe('message');
    expect(summarizeNode(catalog!, { text: 'Hello from the audit! v2' })).toBe(
      'Hello from the audit! v2'
    );
  });

  it('summarizes wait from amount and unit without a type switch', () => {
    const catalog = catalogFromRegistry(defaultRegistry).find(
      (node) => node.type === 'timing.wait'
    );
    expect(summarizeNode(catalog!, { amount: 5, unit: 'minutes' })).toBe(
      'Wait 5 minutes'
    );
    expect(placeholderFor(catalog!, {})).toBe('Set a delay');
  });
});

describe('Node #50 plug-and-play presentation', () => {
  it('flows a new registry node through catalog, summary, fields, and ports', () => {
    const registry = new NodeRegistry();
    registry.register({
      type: 'action.create_deal',
      kind: 'action',
      label: 'Create deal',
      description: 'Open a deal on the contact',
      category: 'crm',
      fieldLabels: { pipeline: { default: 'Default pipeline' } },
      emptyPrompt: 'Name the deal',
      configSchema: z.object({
        title: z.string().min(1),
        pipeline: z.enum(['default', 'sales']).default('default'),
      }),
    });

    const created = catalogFromRegistry(registry)[0];
    expect(created).toMatchObject({
      type: 'action.create_deal',
      label: 'Create deal',
      description: 'Open a deal on the contact',
      category: 'crm',
      kind: 'action',
    });
    expect(created.ports.incoming).toBe(true);
    expect(created.ports.outgoing.map((handle) => handle.label)).toEqual([
      'Next',
    ]);
    expect(created.fieldLabels?.pipeline?.default).toBe('Default pipeline');
    expect(fieldsFromJsonSchema(created.jsonSchema).map((f) => f.name)).toEqual(
      ['title', 'pipeline']
    );
    expect(defaultsFromCatalog(created)).toEqual({ pipeline: 'default' });
    expect(summarizeNode(created, { title: 'Acme retainer' })).toBe(
      'Acme retainer'
    );
    expect(summarizeNode(created, {})).toBe('');
    expect(placeholderFor(created, {})).toBe('Choose title');
  });
});
