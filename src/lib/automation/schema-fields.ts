export interface SchemaField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'enum' | 'boolean' | 'tag';
  enumValues?: string[];
  required: boolean;
  defaultValue?: unknown;
}

function titleCase(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function isTagField(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'tagid' || lower.endsWith('tagid') || lower === 'tag_id';
}

/**
 * Walk a JSON Schema object (from the node registry) into a flat list
 * of form fields. CRM tag pickers are inferred from field names, not
 * from node types — so Node #50 does not require a form switch.
 */
export function fieldsFromJsonSchema(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const root = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    allOf?: unknown[];
  };

  const properties = root.properties
    ? root.properties
    : Array.isArray(root.allOf)
      ? mergeAllOf(root.allOf)
      : {};
  const required = new Set(root.required ?? []);
  const fields: SchemaField[] = [];

  for (const [name, raw] of Object.entries(properties)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as {
      type?: string | string[];
      enum?: unknown[];
      format?: string;
      default?: unknown;
      anyOf?: Array<{ type?: string; enum?: unknown[] }>;
    };

    const enumValues = Array.isArray(prop.enum)
      ? prop.enum.filter((v): v is string => typeof v === 'string')
      : prop.anyOf
          ?.find((o) => Array.isArray(o.enum))
          ?.enum?.filter((v): v is string => typeof v === 'string');

    if (enumValues && enumValues.length > 0) {
      fields.push({
        name,
        label: titleCase(name),
        type: 'enum',
        enumValues,
        required: required.has(name),
        defaultValue: prop.default,
      });
      continue;
    }

    if (isTagField(name)) {
      fields.push({
        name,
        label: 'Tag',
        type: 'tag',
        required: required.has(name),
        defaultValue: prop.default,
      });
      continue;
    }

    const jsonType = Array.isArray(prop.type) ? prop.type[0] : prop.type;
    if (jsonType === 'number' || jsonType === 'integer') {
      fields.push({
        name,
        label: titleCase(name),
        type: 'number',
        required: required.has(name),
        defaultValue: prop.default,
      });
      continue;
    }
    if (jsonType === 'boolean') {
      fields.push({
        name,
        label: titleCase(name),
        type: 'boolean',
        required: required.has(name),
        defaultValue: prop.default,
      });
      continue;
    }

    fields.push({
      name,
      label: titleCase(name),
      type: 'string',
      required: required.has(name),
      defaultValue: prop.default,
    });
  }

  return fields;
}

function mergeAllOf(allOf: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const part of allOf) {
    if (!part || typeof part !== 'object') continue;
    const props = (part as { properties?: Record<string, unknown> }).properties;
    if (props) Object.assign(merged, props);
  }
  return merged;
}
