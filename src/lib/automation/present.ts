import type { CatalogNode } from './catalog';
import { fieldsFromJsonSchema } from './schema-fields';

/** Shared enum labels. Nodes attach these via `fieldLabels`; the builder never switches on type. */
export const CHANNEL_FIELD_LABELS: Record<string, string> = {
  any: 'Any channel',
  current: 'Current conversation',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

export function defaultsFromCatalog(
  catalog: CatalogNode
): Record<string, unknown> {
  if (catalog.configDefaults && Object.keys(catalog.configDefaults).length > 0) {
    return { ...catalog.configDefaults };
  }
  const config: Record<string, unknown> = {};
  for (const field of fieldsFromJsonSchema(catalog.jsonSchema)) {
    if (field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue;
    }
  }
  return config;
}

export function mergeConfigDefaults(
  catalog: CatalogNode,
  config: Record<string, unknown>
): Record<string, unknown> {
  return { ...defaultsFromCatalog(catalog), ...config };
}

export function enumLabel(
  catalog: CatalogNode,
  field: string,
  value: string
): string {
  return catalog.fieldLabels?.[field]?.[value] ?? value;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Canvas one-liner from catalog + config. No node-type switches: schema
 * fields, preview hint, and optional fieldLabels are the whole contract.
 */
export function summarizeNode(
  catalog: CatalogNode,
  config: Record<string, unknown>,
  tagNames?: Record<string, string>
): string {
  const merged = mergeConfigDefaults(catalog, config);
  const fields = fieldsFromJsonSchema(catalog.jsonSchema).filter(
    (field) => field.name !== 'subject'
  );

  if (catalog.preview === 'message') {
    const text = merged.text;
    if (typeof text === 'string' && text.trim()) {
      const trimmed = text.trim();
      return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
    }
  }

  const amount = merged.amount;
  const unit = merged.unit;
  if (typeof amount === 'number' && typeof unit === 'string' && unit) {
    return `Wait ${amount} ${unit}`;
  }
  const until = merged.until;
  if (typeof until === 'string' && until) {
    return `Until ${until}`;
  }

  for (const [index, field] of fields.entries()) {
    const value = merged[field.name];
    if (isEmpty(value)) {
      // Don't fall through to later defaulted enums (e.g. condition `op`)
      // when the primary field is still empty.
      if (field.required || index === 0) return '';
      continue;
    }

    if (field.type === 'tag' && typeof value === 'string') {
      const name = tagNames?.[value];
      if (name) return name;
      continue;
    }
    if (field.type === 'stringList' && Array.isArray(value)) {
      const keywords = value.filter((item) => typeof item === 'string');
      if (keywords.length === 0) {
        if (field.required || index === 0) return '';
        continue;
      }
      const match =
        typeof merged.matchType === 'string'
          ? enumLabel(catalog, 'matchType', merged.matchType)
          : null;
      const sample = keywords.slice(0, 3).join(', ');
      return match ? `${match}: ${sample}` : sample;
    }
    if (field.type === 'boolean') {
      if (value === true) return field.label;
      continue;
    }
    if (field.type === 'enum' && typeof value === 'string') {
      return enumLabel(catalog, field.name, value);
    }
    if (field.type === 'string' && typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();
      return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
    }
    if (field.type === 'number' && typeof value === 'number') {
      return String(value);
    }
  }

  return '';
}

export function placeholderFor(
  catalog: CatalogNode | undefined,
  config: Record<string, unknown> = {}
): string {
  if (!catalog) return 'Click to configure';
  const merged = mergeConfigDefaults(catalog, config);
  const missing = fieldsFromJsonSchema(catalog.jsonSchema).find(
    (field) => field.required && isEmpty(merged[field.name])
  );
  if (missing) return `Choose ${missing.label.toLowerCase()}`;
  if (catalog.emptyPrompt) return catalog.emptyPrompt;
  switch (catalog.kind) {
    case 'trigger':
      return 'Choose how it starts';
    case 'condition':
      return 'Click to add a condition';
    case 'wait':
      return 'Set a delay';
    default:
      return 'Click to configure';
  }
}
