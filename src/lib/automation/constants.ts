/** Safety cap: sequential nodes processed in one worker invocation. */
export const MAX_NODE_EXECUTIONS_PER_INVOCATION = 25;

/** Safety cap: nodes processed across the lifetime of one run. */
export const MAX_NODE_EXECUTIONS_PER_RUN = 200;

/**
 * Architectural loop guard. CRM events start at 0. Each automation-
 * generated event increments depth. Matching stops at this ceiling
 * instead of special-casing every action/trigger pair.
 */
export const MAX_EVENT_CHAIN_DEPTH = 3;

/** Per-node retry budget for retryable side-effect failures. */
export const MAX_NODE_ATTEMPTS = 3;

export const EVENT_RETENTION_DAYS = 90;
export const VERSION_RETENTION_DAYS = 30;
export const MAX_RETAINED_VERSIONS = 10;

export const DEFAULT_REENTRY_POLICY = 'one_active' as const;
