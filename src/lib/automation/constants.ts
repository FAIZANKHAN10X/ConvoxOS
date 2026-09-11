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

/**
 * ManyChat parity: at most this many blocks may run without a pause
 * (an input-waiting or timer-suspending node) for one contact. Longer
 * chains must insert a pause — buttons, delays, or data collection —
 * instead of silently stopping mid-flow like the reference product.
 */
export const MAX_BLOCKS_WITHOUT_PAUSE = 30;

export const EVENT_RETENTION_DAYS = 90;
export const VERSION_RETENTION_DAYS = 30;
export const MAX_RETAINED_VERSIONS = 10;

export const DEFAULT_REENTRY_POLICY = 'one_active' as const;

/**
 * A `claimed` event wait older than this is treated as orphaned (the
 * process died between claim and resume) and may be reclaimed by the
 * next callback. Must exceed the longest single executeRun duration.
 */
export const STALE_EVENT_WAIT_CLAIM_MS = 5 * 60 * 1000;

/**
 * How long a callback waits for its wait row to commit before the
 * worker stops deferring and falls through to normal trigger
 * matching (which surfaces a misconfigured flow visibly instead of
 * looping forever).
 */
export const CALLBACK_DEFERRAL_MS = 30 * 1000;

/** Max deferrals per callback event before falling through to matching. */
export const MAX_CALLBACK_DEFERRALS = 10;

/**
 * A `running` run whose heartbeat (`updated_at`, touched after every
 * node) is older than this died mid-executeRun and may be reclaimed
 * by claim_due_automation_runs. Must far exceed the longest single
 * tick (route maxDuration 60s; per-node updates keep healthy runs
 * fresh). Engine replays via succeeded-step skip, so re-execution is
 * safe for idempotent nodes.
 */
export const STALE_RUNNING_RUN_CLAIM_MS = 10 * 60 * 1000;
