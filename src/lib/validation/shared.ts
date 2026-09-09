/**
 * Shared validation kernel for CRM messaging targets.
 *
 * Canonical home for small domain rules reused across builders
 * (sequences, broadcasts): channel-target allowlist + multi-predicate
 * condition validation. Each function encapsulates ONE domain rule.
 */

export const ALLOWED_CHANNEL_TARGETS = new Set(["current", "whatsapp", "telegram"] as const)

export function isValidChannel(v: unknown): boolean {
  return typeof v === "string" && (ALLOWED_CHANNEL_TARGETS as Set<string>).has(v)
}

export function validateChannelTarget(
  raw: unknown,
  options?: { required?: boolean },
): string | null {
  const required = options?.required ?? true
  if (raw == null || raw === "") {
    return required ? 'channel must be "current", "whatsapp" or "telegram"' : null
  }
  if (!isValidChannel(raw)) {
    return 'channel must be "current", "whatsapp" or "telegram"'
  }
  return null
}

// ------------------------------------------------------------
// Condition validation — `match: all|any` + array of predicates
// Used by sequence/CRM condition builders.
// ------------------------------------------------------------

export interface ConditionPredicate {
  field?: unknown
  operator?: unknown
  value?: unknown
}

export function validateConditionPredicates(
  conditions: unknown,
  match: unknown,
): string[] {
  const errors: string[] = []
  if (!Array.isArray(conditions) || conditions.length === 0) {
    errors.push("condition needs at least one predicate")
    return errors
  }
  if (match !== undefined && match !== "all" && match !== "any") {
    errors.push('match must be "all" or "any"')
  }
  conditions.forEach((c, i) => {
    const pred = c as ConditionPredicate
    if (!pred.field || typeof pred.field !== "string" || !pred.field.trim()) {
      errors.push(`conditions[${i}].field is required`)
    }
    if (!pred.operator || typeof pred.operator !== "string") {
      errors.push(`conditions[${i}].operator is required`)
    }
    // value may be empty for operators like is_empty — not validated here
  })
  return errors
}

// ------------------------------------------------------------
// Wait validation — amount + unit + next
// ------------------------------------------------------------

export function validateWaitConfig(config: Record<string, unknown>): string[] {
  const errors: string[] = []
  const amount = config.amount as unknown
  const unit = config.unit as unknown
  const next = config.next_node_key ?? config.next ?? config.nextNodeKey

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    errors.push("wait amount must be a positive number")
  }
  const allowedUnits = new Set(["seconds", "minutes", "hours", "days"])
  if (typeof unit !== "string" || !allowedUnits.has(unit)) {
    errors.push('wait unit must be one of: seconds, minutes, hours, days')
  }
  if (next != null && next !== "" && typeof next !== "string") {
    errors.push("wait next_node_key must be a string")
  }
  return errors
}

// ------------------------------------------------------------
// Randomizer — variants with weight 0..100, ids unique, sum 100
// ------------------------------------------------------------

export interface RandomizerVariant {
  id?: unknown
  weight?: unknown
  next_node_key?: unknown
}

export function validateRandomizerVariants(variants: unknown): string[] {
  const errors: string[] = []
  if (!Array.isArray(variants) || variants.length < 2) {
    errors.push("randomizer needs at least 2 variants")
    return errors
  }
  const seenIds = new Set<string>()
  let total = 0
  variants.forEach((v, i) => {
    const row = v as RandomizerVariant
    const id = row.id as string | undefined
    if (!id || typeof id !== "string" || !id.trim()) {
      errors.push(`variants[${i}].id is required`)
    } else if (seenIds.has(id)) {
      errors.push(`variants[${i}].id "${id}" is duplicated`)
    } else {
      seenIds.add(id)
    }
    const w = row.weight as number | undefined
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100) {
      errors.push(`variants[${i}].weight must be 0..100`)
    } else {
      total += w
    }
  })
  if (Math.abs(total - 100) > 0.01) {
    errors.push(`variant weights must sum to 100 (got ${total})`)
  }
  return errors
}
