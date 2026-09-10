// ============================================================
// {{path.to.value}} interpolation for automation config strings.
//
// Scope is the run context (ids, event, accumulated vars) — never
// secrets, never the database. Missing paths resolve to an empty
// string so a typo fails loudly downstream (invalid URL, schema
// error) instead of silently sending a literal "{{...}}".
// ============================================================

function lookup(scope: Record<string, unknown>, path: string): unknown {
  let current: unknown = scope;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key.trim()];
  }
  return current;
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export function interpolateTemplate(
  template: string,
  scope: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) =>
    renderValue(lookup(scope, path))
  );
}
