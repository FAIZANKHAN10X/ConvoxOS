import type {
  AutomationStore,
  InsertAutomationInput,
  InsertRunInput,
  InsertStepInput,
  InsertWaitInput,
  RunPatch,
} from './store';
import { ActiveRunConflict, isActiveRunStatus } from './store';
import { STALE_EVENT_WAIT_CLAIM_MS, STALE_RUNNING_RUN_CLAIM_MS } from './constants';
import { emptyGraph } from './graph';
import type {
  Automation,
  AutomationRun,
  AutomationVersion,
  AutomationWait,
  DomainEvent,
  DomainEventStatus,
  NewDomainEvent,
  PublishedTrigger,
  RunStep,
  StepStatus,
} from './types';

function iso(now: Date): string {
  return now.toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Stale `claimed` rows are crash orphans, safe to reclaim. */
function isStaleClaim(
  w: { status: string; claimedAt: string | null },
  now: Date
): boolean {
  if (w.status !== 'claimed') return false;
  if (!w.claimedAt) return true;
  return (
    now.getTime() - new Date(w.claimedAt).getTime() >
    STALE_EVENT_WAIT_CLAIM_MS
  );
}

/**
 * Deterministic in-memory store for engine tests. Not used in
 * production. Claim methods mutate status the same way the SKIP LOCKED
 * RPCs do.
 */
export function createMemoryStore(
  clock: () => Date = () => new Date()
): AutomationStore {
  const events = new Map<string, DomainEvent>();
  const automations = new Map<string, Automation>();
  const versions = new Map<string, AutomationVersion>();
  const runs = new Map<string, AutomationRun>();
  const steps = new Map<string, RunStep>();
  const waits = new Map<string, AutomationWait>();

  const store: AutomationStore = {
    async insertEvent(input: NewDomainEvent): Promise<DomainEvent> {
      for (const existing of events.values()) {
        if (
          existing.accountId === input.accountId &&
          existing.idempotencyKey === input.idempotencyKey
        ) {
          return clone(existing);
        }
      }
      const now = clock();
      const row: DomainEvent = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        eventType: input.eventType,
        contactId: input.contactId ?? null,
        payload: input.payload ?? {},
        source: input.source ?? 'crm',
        originRunId: input.originRunId ?? null,
        causationEventId: input.causationEventId ?? null,
        chainDepth: input.chainDepth ?? 0,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        attempts: 0,
        availableAt: input.availableAt ?? iso(now),
        processedAt: null,
        lastError: null,
        createdAt: iso(now),
      };
      events.set(row.id, row);
      return clone(row);
    },

    async getEvent(id) {
      const row = events.get(id);
      return row ? clone(row) : null;
    },

    async claimPendingEvents(limit, now) {
      const due = [...events.values()]
        .filter(
          (e) =>
            e.status === 'pending' &&
            new Date(e.availableAt).getTime() <= now.getTime()
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
      const claimed: DomainEvent[] = [];
      for (const e of due) {
        e.status = 'processing';
        e.attempts += 1;
        claimed.push(clone(e));
      }
      return claimed;
    },

    async markEvent(
      id: string,
      status: DomainEventStatus,
      error?: string | null
    ) {
      const row = events.get(id);
      if (!row) return;
      row.status = status;
      row.lastError = error ?? null;
      if (
        status === 'processed' ||
        status === 'skipped' ||
        status === 'failed'
      ) {
        row.processedAt = iso(clock());
      }
    },

    async deferEvent(id: string, availableAt: Date) {
      const row = events.get(id);
      if (!row) return;
      row.status = 'pending';
      row.availableAt = iso(availableAt);
    },

    async insertAutomation(input: InsertAutomationInput): Promise<Automation> {
      const now = iso(clock());
      const row: Automation = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        createdBy: input.createdBy,
        name: input.name,
        description: input.description ?? null,
        status: 'draft',
        draftGraph: input.draftGraph ?? emptyGraph(),
        draftTrigger: input.draftTrigger ?? null,
        publishedVersionId: null,
        createdAt: now,
        updatedAt: now,
      };
      automations.set(row.id, row);
      return clone(row);
    },

    async getAutomation(id) {
      const row = automations.get(id);
      return row ? clone(row) : null;
    },

    async deleteAutomation(id) {
      automations.delete(id);
    },

    async updateAutomation(id, patch) {
      const row = automations.get(id);
      if (!row) throw new Error(`automation ${id} not found`);
      Object.assign(row, patch, { updatedAt: iso(clock()) });
      return clone(row);
    },

    async listPublishedTriggers(accountId): Promise<PublishedTrigger[]> {
      const out: PublishedTrigger[] = [];
      for (const auto of automations.values()) {
        if (auto.accountId !== accountId || auto.status !== 'published')
          continue;
        if (!auto.publishedVersionId) continue;
        const version = versions.get(auto.publishedVersionId);
        if (!version) continue;
        out.push({
          automationId: auto.id,
          accountId: auto.accountId,
          versionId: version.id,
          trigger: clone(version.trigger),
        });
      }
      return out;
    },

    async insertVersion(input) {
      const row: AutomationVersion = {
        id: crypto.randomUUID(),
        automationId: input.automationId,
        accountId: input.accountId,
        versionNumber: input.versionNumber,
        graph: clone(input.graph),
        trigger: clone(input.trigger),
        publishedAt: iso(clock()),
        publishedBy: input.publishedBy,
      };
      versions.set(row.id, row);
      return clone(row);
    },

    async getVersion(id) {
      const row = versions.get(id);
      return row ? clone(row) : null;
    },

    async nextVersionNumber(automationId) {
      let max = 0;
      for (const v of versions.values()) {
        if (v.automationId === automationId) {
          max = Math.max(max, v.versionNumber);
        }
      }
      return max + 1;
    },

    async findActiveRun(automationId, contactId) {
      for (const run of runs.values()) {
        if (
          run.automationId === automationId &&
          run.contactId === contactId &&
          isActiveRunStatus(run.status)
        ) {
          return clone(run);
        }
      }
      return null;
    },

    async insertRun(input: InsertRunInput): Promise<AutomationRun> {
      const existing = await store.findActiveRun(
        input.automationId,
        input.contactId
      );
      if (existing) throw new ActiveRunConflict(existing);
      const now = iso(clock());
      const row: AutomationRun = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        automationId: input.automationId,
        versionId: input.versionId,
        contactId: input.contactId,
        triggerEventId: input.triggerEventId ?? null,
        status: 'queued',
        currentNodeId: input.currentNodeId ?? null,
        nodeExecutions: 0,
        attempt: 1,
        context: input.context ?? {},
        lastError: null,
        waitUntil: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      runs.set(row.id, row);
      return clone(row);
    },

    async getRun(id) {
      const row = runs.get(id);
      return row ? clone(row) : null;
    },

    async updateRun(id: string, patch: RunPatch): Promise<AutomationRun> {
      const row = runs.get(id);
      if (!row) throw new Error(`run ${id} not found`);
      Object.assign(row, patch, { updatedAt: iso(clock()) });
      return clone(row);
    },

    async claimRunForExecution(id: string, now: Date): Promise<AutomationRun | null> {
      const row = runs.get(id);
      if (!row) return null;
      if (row.status !== 'queued' && row.status !== 'waiting') return null;
      row.status = 'running';
      row.waitUntil = null;
      row.updatedAt = iso(now);
      return clone(row);
    },

    async claimDueRuns(limit, now) {
      const staleCutoff =
        now.getTime() - STALE_RUNNING_RUN_CLAIM_MS;
      const due = [...runs.values()]
        .filter((r) => {
          if (r.status === 'queued') {
            if (!r.waitUntil) return true;
            return new Date(r.waitUntil).getTime() <= now.getTime();
          }
          // Crash orphan: a `running` run whose heartbeat went stale
          // (the process died mid-executeRun). Reclaim it so the run
          // resumes instead of stalling forever. Healthy ticks touch
          // updatedAt after every node, far inside the lease.
          if (r.status === 'running') {
            return new Date(r.updatedAt).getTime() <= staleCutoff;
          }
          return false;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
      const claimed: AutomationRun[] = [];
      for (const r of due) {
        r.status = 'running';
        r.waitUntil = null;
        r.updatedAt = iso(now);
        claimed.push(clone(r));
      }
      return claimed;
    },

    async insertStep(input: InsertStepInput): Promise<RunStep> {
      const now = iso(clock());
      const row: RunStep = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        runId: input.runId,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        attempt: input.attempt,
        status: 'running',
        idempotencyKey: input.idempotencyKey,
        input: input.input ?? {},
        output: null,
        error: null,
        startedAt: now,
        finishedAt: null,
      };
      steps.set(row.id, row);
      return clone(row);
    },

    async getSucceededStep(runId, nodeId) {
      const match = [...steps.values()].find(
        (s) =>
          s.runId === runId && s.nodeId === nodeId && s.status === 'succeeded'
      );
      return match ? clone(match) : null;
    },

    async listSteps(runId) {
      return [...steps.values()]
        .filter((s) => s.runId === runId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map(clone);
    },

    async updateStep(
      id: string,
      patch: {
        status: StepStatus;
        output?: Record<string, unknown> | null;
        error?: string | null;
        finishedAt?: string;
      }
    ) {
      const row = steps.get(id);
      if (!row) return;
      row.status = patch.status;
      if (patch.output !== undefined) row.output = patch.output;
      if (patch.error !== undefined) row.error = patch.error;
      row.finishedAt = patch.finishedAt ?? iso(clock());
    },

    async insertWait(input: InsertWaitInput): Promise<AutomationWait> {
      const row: AutomationWait = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        runId: input.runId,
        nodeId: input.nodeId,
        resumeNodeId: input.resumeNodeId,
        resumeAt: input.resumeAt,
        status: 'pending',
        kind: input.kind ?? 'time',
        correlationKey: input.correlationKey ?? null,
        claimedAt: null,
        createdAt: iso(clock()),
      };
      waits.set(row.id, row);
      return clone(row);
    },

    async claimDueWaits(limit, now) {
      const due = [...waits.values()]
        .filter((w) => {
          if (new Date(w.resumeAt).getTime() > now.getTime()) return false;
          if (w.status === 'pending') return true;
          // Crash orphan: claimed but never resumed (process died
          // between claim and resume). Reclaim after the lease.
          return isStaleClaim(w, now);
        })
        .sort((a, b) => a.resumeAt.localeCompare(b.resumeAt))
        .slice(0, limit);
      const claimed: AutomationWait[] = [];
      for (const w of due) {
        w.status = 'claimed';
        w.claimedAt = iso(now);
        claimed.push(clone(w));
      }
      return claimed;
    },

    async claimEventWait(args) {
      const now = clock();
      const match = [...waits.values()].find((w) => {
        if (w.kind !== 'event') return false;
        if (w.accountId !== args.accountId) return false;
        if (w.correlationKey !== args.correlationKey) return false;
        if (w.status !== 'pending' && !isStaleClaim(w, now)) return false;
        const run = runs.get(w.runId);
        return (
          !!run &&
          run.automationId === args.automationId &&
          run.status === 'waiting'
        );
      });
      if (!match) return null;
      match.status = 'claimed';
      match.claimedAt = iso(now);
      return clone(match);
    },

    async findEventWait(args) {
      const match = [...waits.values()].find(
        (w) =>
          w.accountId === args.accountId &&
          w.correlationKey === args.correlationKey &&
          w.kind === 'event'
      );
      return match ? clone(match) : null;
    },

    async cancelWaitsForRun(runId) {
      for (const w of waits.values()) {
        if (
          w.runId === runId &&
          (w.status === 'pending' || w.status === 'claimed')
        ) {
          w.status = 'cancelled';
        }
      }
    },
  };

  return store;
}
