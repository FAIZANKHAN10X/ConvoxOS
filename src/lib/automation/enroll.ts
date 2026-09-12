import type {
  AutomationRun,
  EnrollmentSkipReason,
  ReentryPolicy,
} from './types';

export interface EnrollmentGate {
  reentryPolicy: ReentryPolicy;
  activeRun: AutomationRun | null;
  priorRun: boolean;
}

export type EnrollmentDecision =
  | { decision: 'enroll' }
  | { decision: 'skip'; reason: EnrollmentSkipReason; existingRunId: string | null };

/**
 * T5.4: the single deterministic enrollment rule. Same inputs →
 * same outcome, always:
 * - an active run for this contact + automation blocks (the first
 *   writer wins; the existing run continues untouched).
 * - `once` additionally blocks when any prior run exists.
 * - `repeat` enrolls whenever no active run exists.
 */
export function evaluateEnrollment(gate: EnrollmentGate): EnrollmentDecision {
  if (gate.activeRun) {
    return {
      decision: 'skip',
      reason: 'active_run',
      existingRunId: gate.activeRun.id,
    };
  }
  if (gate.reentryPolicy === 'once' && gate.priorRun) {
    return { decision: 'skip', reason: 'already_enrolled', existingRunId: null };
  }
  return { decision: 'enroll' };
}
