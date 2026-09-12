import type {
  Automation,
  AutomationGraph,
  AutomationRun,
  AutomationStatus,
  AutomationVersion,
  AutomationWait,
  DomainEvent,
  DomainEventStatus,
  EnrollmentSkipReason,
  NewDomainEvent,
  PublishedTrigger,
  RunStatus,
  RunStep,
  StepStatus,
  TriggerSpec,
  WaitKind,
} from './types';

export interface InsertAutomationInput {
  accountId: string;
  createdBy: string;
  name: string;
  description?: string | null;
  draftGraph?: AutomationGraph;
  draftTrigger?: TriggerSpec | null;
}

export interface InsertRunInput {
  accountId: string;
  automationId: string;
  versionId: string;
  contactId: string;
  triggerEventId?: string | null;
  currentNodeId?: string | null;
  context?: Record<string, unknown>;
}

export interface InsertStepInput {
  accountId: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  attempt: number;
  idempotencyKey: string;
  input?: Record<string, unknown>;
}

export interface InsertWaitInput {
  accountId: string;
  runId: string;
  nodeId: string;
  resumeNodeId: string | null;
  resumeAt: string;
  kind?: WaitKind;
  correlationKey?: string | null;
}

export interface RunPatch {
  status?: RunStatus;
  currentNodeId?: string | null;
  nodeExecutions?: number;
  attempt?: number;
  context?: Record<string, unknown>;
  lastError?: string | null;
  waitUntil?: string | null;
  completedAt?: string | null;
}

/**
 * Persistence seam for the engine and worker. Production uses
 * Postgres; tests use an in-memory implementation. This is not a
 * generic repository — it is the exact operations the engine needs.
 */
export interface AutomationStore {
  insertEvent(input: NewDomainEvent): Promise<DomainEvent>;
  getEvent(id: string): Promise<DomainEvent | null>;
  claimPendingEvents(limit: number, now: Date): Promise<DomainEvent[]>;
  markEvent(
    id: string,
    status: DomainEventStatus,
    error?: string | null
  ): Promise<void>;
  /**
   * Requeue a claimed event for later redelivery (callback arrived
   * before its wait row committed). The next claim bumps `attempts`,
   * which bounds total deferrals — see worker deferral cap.
   */
  deferEvent(id: string, availableAt: Date): Promise<void>;

  insertAutomation(input: InsertAutomationInput): Promise<Automation>;
  getAutomation(id: string): Promise<Automation | null>;
  deleteAutomation(id: string): Promise<void>;
  updateAutomation(
    id: string,
    patch: Partial<
      Pick<
        Automation,
        | 'name'
        | 'description'
        | 'status'
        | 'draftGraph'
        | 'draftTrigger'
        | 'publishedVersionId'
        | 'reentryPolicy'
        | 'stopOnReply'
      >
    >
  ): Promise<Automation>;
  listPublishedTriggers(accountId: string): Promise<PublishedTrigger[]>;

  insertVersion(input: {
    automationId: string;
    accountId: string;
    versionNumber: number;
    graph: AutomationGraph;
    trigger: TriggerSpec;
    publishedBy: string | null;
  }): Promise<AutomationVersion>;
  getVersion(id: string): Promise<AutomationVersion | null>;
  nextVersionNumber(automationId: string): Promise<number>;

  findActiveRun(
    automationId: string,
    contactId: string
  ): Promise<AutomationRun | null>;
  /**
   * T5.4: true when any run (active or terminal) exists for this
   * contact + automation. Backs the `once` re-entry policy.
   */
  hasAnyRun(automationId: string, contactId: string): Promise<boolean>;
  /**
   * T5.4: record a skipped enrollment (conflict or re-entry block)
   * so the decision trail is deterministic and debuggable.
   * Enrollments are already recorded as runs — only skips go here.
   */
  recordEnrollmentSkip(input: {
    accountId: string;
    automationId: string;
    contactId: string;
    eventId?: string | null;
    reason: EnrollmentSkipReason;
    existingRunId?: string | null;
  }): Promise<void>;
  insertRun(input: InsertRunInput): Promise<AutomationRun>;
  getRun(id: string): Promise<AutomationRun | null>;
  updateRun(id: string, patch: RunPatch): Promise<AutomationRun>;
  /**
   * Atomic compare-and-set for mutual exclusion: transitions a
   * `queued`/`waiting` run to `running` (clearing `waitUntil`) and
   * returns it, or returns null when another worker owns the run
   * (already `running`) or it is terminal. Callers must NOT execute
   * on null — the winner executes. Paths that already hold a claim
   * (claimDueRuns SKIP LOCKED) pass through executeRun's skipClaim.
   */
  claimRunForExecution(id: string, now: Date): Promise<AutomationRun | null>;
  claimDueRuns(limit: number, now: Date): Promise<AutomationRun[]>;

  insertStep(input: InsertStepInput): Promise<RunStep>;
  getSucceededStep(runId: string, nodeId: string): Promise<RunStep | null>;
  listSteps(runId: string): Promise<RunStep[]>;
  updateStep(
    id: string,
    patch: {
      status: StepStatus;
      output?: Record<string, unknown> | null;
      error?: string | null;
      finishedAt?: string;
    }
  ): Promise<void>;

  insertWait(input: InsertWaitInput): Promise<AutomationWait>;
  claimDueWaits(limit: number, now: Date): Promise<AutomationWait[]>;
  claimEventWait(args: {
    accountId: string;
    correlationKey: string;
    automationId: string;
  }): Promise<AutomationWait | null>;
  findEventWait(args: {
    accountId: string;
    correlationKey: string;
  }): Promise<AutomationWait | null>;
  cancelWaitsForRun(runId: string): Promise<void>;
}

export class ActiveRunConflict extends Error {
  readonly existing: AutomationRun;

  constructor(existing: AutomationRun) {
    super('An active run already exists for this contact and automation');
    this.name = 'ActiveRunConflict';
    this.existing = existing;
  }
}

export function isActiveRunStatus(
  status: AutomationStatus | RunStatus
): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting';
}
