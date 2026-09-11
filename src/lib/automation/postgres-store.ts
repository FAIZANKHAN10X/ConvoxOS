import type { SupabaseClient } from '@supabase/supabase-js';

import { mapEventRow } from './events';
import { emptyGraph } from './graph';
import {
  ActiveRunConflict,
  type AutomationStore,
  type InsertAutomationInput,
  type InsertRunInput,
  type InsertStepInput,
  type InsertWaitInput,
  type RunPatch,
} from './store';
import type {
  Automation,
  AutomationGraph,
  AutomationRun,
  AutomationStatus,
  AutomationVersion,
  AutomationWait,
  DomainEvent,
  DomainEventStatus,
  PublishedTrigger,
  RunStatus,
  RunStep,
  StepStatus,
  TriggerSpec,
} from './types';

function asGraph(value: unknown): AutomationGraph {
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as AutomationGraph).nodes) &&
    Array.isArray((value as AutomationGraph).edges)
  ) {
    return value as AutomationGraph;
  }
  return emptyGraph();
}

function asTrigger(value: unknown): TriggerSpec | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as TriggerSpec).type === 'string'
  ) {
    return {
      type: (value as TriggerSpec).type,
      config: (value as TriggerSpec).config ?? {},
    };
  }
  return null;
}

export function mapAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    createdBy: row.created_by as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    status: row.status as AutomationStatus,
    draftGraph: asGraph(row.draft_graph),
    draftTrigger: asTrigger(row.draft_trigger),
    publishedVersionId: (row.published_version_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapVersion(row: Record<string, unknown>): AutomationVersion {
  const trigger = asTrigger(row.trigger);
  if (!trigger) throw new Error('automation version missing trigger');
  return {
    id: row.id as string,
    automationId: row.automation_id as string,
    accountId: row.account_id as string,
    versionNumber: row.version_number as number,
    graph: asGraph(row.graph),
    trigger,
    publishedAt: row.published_at as string,
    publishedBy: (row.published_by as string | null) ?? null,
  };
}

export function mapRun(row: Record<string, unknown>): AutomationRun {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    automationId: row.automation_id as string,
    versionId: row.version_id as string,
    contactId: row.contact_id as string,
    triggerEventId: (row.trigger_event_id as string | null) ?? null,
    status: row.status as RunStatus,
    currentNodeId: (row.current_node_id as string | null) ?? null,
    nodeExecutions: (row.node_executions as number) ?? 0,
    attempt: (row.attempt as number) ?? 1,
    context: (row.context as Record<string, unknown>) ?? {},
    lastError: (row.last_error as string | null) ?? null,
    waitUntil: (row.wait_until as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export function mapStep(row: Record<string, unknown>): RunStep {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    runId: row.run_id as string,
    nodeId: row.node_id as string,
    nodeType: row.node_type as string,
    attempt: row.attempt as number,
    status: row.status as StepStatus,
    idempotencyKey: row.idempotency_key as string,
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown> | null) ?? null,
    error: (row.error as string | null) ?? null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

function mapWait(row: Record<string, unknown>): AutomationWait {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    runId: row.run_id as string,
    nodeId: row.node_id as string,
    resumeNodeId: (row.resume_node_id as string | null) ?? null,
    resumeAt: row.resume_at as string,
    status: row.status as AutomationWait['status'],
    kind: (row.kind as AutomationWait['kind']) ?? 'time',
    correlationKey: (row.correlation_key as string | null) ?? null,
    claimedAt: (row.claimed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function throwIfError(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function createPostgresStore(db: SupabaseClient): AutomationStore {
  return {
    async insertEvent(input) {
      const { data, error } = await db
        .from('domain_events')
        .insert({
          account_id: input.accountId,
          event_type: input.eventType,
          contact_id: input.contactId ?? null,
          payload: input.payload ?? {},
          source: input.source ?? 'crm',
          origin_run_id: input.originRunId ?? null,
          causation_event_id: input.causationEventId ?? null,
          chain_depth: input.chainDepth ?? 0,
          idempotency_key: input.idempotencyKey,
          available_at: input.availableAt ?? new Date().toISOString(),
        })
        .select('*')
        .maybeSingle();

      if (error?.code === '23505') {
        const { data: existing, error: readError } = await db
          .from('domain_events')
          .select('*')
          .eq('account_id', input.accountId)
          .eq('idempotency_key', input.idempotencyKey)
          .maybeSingle();
        throwIfError(readError, 'read conflicting domain event');
        if (!existing) throw new Error('domain event conflict without row');
        return mapEventRow(existing);
      }
      throwIfError(error, 'insert domain event');
      if (!data) throw new Error('insert domain event: no row');
      return mapEventRow(data);
    },

    async getEvent(id) {
      const { data, error } = await db
        .from('domain_events')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'get domain event');
      return data ? mapEventRow(data) : null;
    },

    async claimPendingEvents(limit) {
      const { data, error } = await db.rpc('claim_domain_events', {
        p_limit: limit,
      });
      throwIfError(error, 'claim domain events');
      return ((data ?? []) as Record<string, unknown>[]).map(mapEventRow);
    },

    async markEvent(
      id: string,
      status: DomainEventStatus,
      err?: string | null
    ) {
      const patch: Record<string, unknown> = {
        status,
        last_error: err ?? null,
      };
      if (
        status === 'processed' ||
        status === 'skipped' ||
        status === 'failed'
      ) {
        patch.processed_at = new Date().toISOString();
      }
      const { error } = await db
        .from('domain_events')
        .update(patch)
        .eq('id', id);
      throwIfError(error, 'mark domain event');
    },

    async deferEvent(id: string, availableAt: Date) {
      const { error } = await db
        .from('domain_events')
        .update({
          status: 'pending',
          available_at: availableAt.toISOString(),
        })
        .eq('id', id);
      throwIfError(error, 'defer domain event');
    },

    async insertAutomation(input: InsertAutomationInput) {
      const { data, error } = await db
        .from('automations')
        .insert({
          account_id: input.accountId,
          created_by: input.createdBy,
          name: input.name,
          description: input.description ?? null,
          draft_graph: input.draftGraph ?? emptyGraph(),
          draft_trigger: input.draftTrigger ?? null,
        })
        .select('*')
        .single();
      throwIfError(error, 'insert automation');
      return mapAutomation(data as Record<string, unknown>);
    },

    async getAutomation(id) {
      const { data, error } = await db
        .from('automations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'get automation');
      return data ? mapAutomation(data) : null;
    },

    async deleteAutomation(id) {
      const { error } = await db.from('automations').delete().eq('id', id);
      throwIfError(error, 'delete automation');
    },

    async updateAutomation(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.draftGraph !== undefined) row.draft_graph = patch.draftGraph;
      if (patch.draftTrigger !== undefined)
        row.draft_trigger = patch.draftTrigger;
      if (patch.publishedVersionId !== undefined) {
        row.published_version_id = patch.publishedVersionId;
      }
      const { data, error } = await db
        .from('automations')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();
      throwIfError(error, 'update automation');
      return mapAutomation(data as Record<string, unknown>);
    },

    async listPublishedTriggers(accountId): Promise<PublishedTrigger[]> {
      const { data: autos, error } = await db
        .from('automations')
        .select('id, account_id, published_version_id')
        .eq('account_id', accountId)
        .eq('status', 'published')
        .not('published_version_id', 'is', null);
      throwIfError(error, 'list published automations');

      const versionIds = (autos ?? [])
        .map((row) => row.published_version_id as string | null)
        .filter((id): id is string => Boolean(id));
      if (versionIds.length === 0) return [];

      const { data: versions, error: versionError } = await db
        .from('automation_versions')
        .select('id, trigger')
        .in('id', versionIds);
      throwIfError(versionError, 'list published versions');

      const triggerByVersion = new Map<string, TriggerSpec>();
      for (const row of (versions ?? []) as Array<Record<string, unknown>>) {
        const trigger = asTrigger(row.trigger);
        if (trigger) triggerByVersion.set(row.id as string, trigger);
      }

      const out: PublishedTrigger[] = [];
      for (const row of autos ?? []) {
        const versionId = row.published_version_id as string | null;
        if (!versionId) continue;
        const trigger = triggerByVersion.get(versionId);
        if (!trigger) continue;
        out.push({
          automationId: row.id as string,
          accountId: row.account_id as string,
          versionId,
          trigger,
        });
      }
      return out;
    },

    async insertVersion(input) {
      const { data, error } = await db
        .from('automation_versions')
        .insert({
          automation_id: input.automationId,
          account_id: input.accountId,
          version_number: input.versionNumber,
          graph: input.graph,
          trigger: input.trigger,
          published_by: input.publishedBy,
        })
        .select('*')
        .single();
      throwIfError(error, 'insert automation version');
      return mapVersion(data as Record<string, unknown>);
    },

    async getVersion(id) {
      const { data, error } = await db
        .from('automation_versions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'get automation version');
      return data ? mapVersion(data) : null;
    },

    async nextVersionNumber(automationId) {
      const { data, error } = await db
        .from('automation_versions')
        .select('version_number')
        .eq('automation_id', automationId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(error, 'next version number');
      return ((data?.version_number as number | undefined) ?? 0) + 1;
    },

    async findActiveRun(automationId, contactId) {
      const { data, error } = await db
        .from('automation_runs')
        .select('*')
        .eq('automation_id', automationId)
        .eq('contact_id', contactId)
        .in('status', ['queued', 'running', 'waiting'])
        .maybeSingle();
      throwIfError(error, 'find active run');
      return data ? mapRun(data) : null;
    },

    async insertRun(input: InsertRunInput) {
      const { data, error } = await db
        .from('automation_runs')
        .insert({
          account_id: input.accountId,
          automation_id: input.automationId,
          version_id: input.versionId,
          contact_id: input.contactId,
          trigger_event_id: input.triggerEventId ?? null,
          current_node_id: input.currentNodeId ?? null,
          context: input.context ?? {},
        })
        .select('*')
        .single();
      if (error?.code === '23505') {
        const existing = await this.findActiveRun(
          input.automationId,
          input.contactId
        );
        if (existing) throw new ActiveRunConflict(existing);
      }
      throwIfError(error, 'insert automation run');
      return mapRun(data as Record<string, unknown>);
    },

    async getRun(id) {
      const { data, error } = await db
        .from('automation_runs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'get automation run');
      return data ? mapRun(data) : null;
    },

    async updateRun(id: string, patch: RunPatch): Promise<AutomationRun> {
      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.currentNodeId !== undefined) {
        row.current_node_id = patch.currentNodeId;
      }
      if (patch.nodeExecutions !== undefined) {
        row.node_executions = patch.nodeExecutions;
      }
      if (patch.attempt !== undefined) row.attempt = patch.attempt;
      if (patch.context !== undefined) row.context = patch.context;
      if (patch.lastError !== undefined) row.last_error = patch.lastError;
      if (patch.waitUntil !== undefined) row.wait_until = patch.waitUntil;
      if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
      const { data, error } = await db
        .from('automation_runs')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();
      throwIfError(error, 'update automation run');
      return mapRun(data as Record<string, unknown>);
    },

    async claimRunForExecution(id: string, now: Date): Promise<AutomationRun | null> {
      // Atomic CAS: only one worker wins the queued/waiting → running
      // transition. A concurrent loser gets no row (null) and must not
      // execute. Plain get+update would let two workers interleave.
      const { data, error } = await db
        .from('automation_runs')
        .update({
          status: 'running',
          wait_until: null,
          updated_at: now.toISOString(),
        })
        .eq('id', id)
        .in('status', ['queued', 'waiting'])
        .select('*')
        .maybeSingle();
      throwIfError(error, 'claim automation run');
      return data ? mapRun(data as Record<string, unknown>) : null;
    },

    async claimDueRuns(limit) {
      const { data, error } = await db.rpc('claim_due_automation_runs', {
        p_limit: limit,
      });
      throwIfError(error, 'claim due automation runs');
      return ((data ?? []) as Record<string, unknown>[]).map(mapRun);
    },

    async insertStep(input: InsertStepInput) {
      const { data, error } = await db
        .from('automation_run_steps')
        .insert({
          account_id: input.accountId,
          run_id: input.runId,
          node_id: input.nodeId,
          node_type: input.nodeType,
          attempt: input.attempt,
          idempotency_key: input.idempotencyKey,
          input: input.input ?? {},
          status: 'running',
        })
        .select('*')
        .single();
      throwIfError(error, 'insert run step');
      return mapStep(data as Record<string, unknown>);
    },

    async getSucceededStep(runId, nodeId) {
      const { data, error } = await db
        .from('automation_run_steps')
        .select('*')
        .eq('run_id', runId)
        .eq('node_id', nodeId)
        .eq('status', 'succeeded')
        .limit(1)
        .maybeSingle();
      throwIfError(error, 'get succeeded step');
      return data ? mapStep(data) : null;
    },

    async listSteps(runId) {
      const { data, error } = await db
        .from('automation_run_steps')
        .select('*')
        .eq('run_id', runId)
        .order('started_at', { ascending: true });
      throwIfError(error, 'list run steps');
      return ((data ?? []) as Record<string, unknown>[]).map(mapStep);
    },

    async updateStep(id, patch) {
      const { error } = await db
        .from('automation_run_steps')
        .update({
          status: patch.status,
          output: patch.output ?? undefined,
          error: patch.error ?? null,
          finished_at: patch.finishedAt ?? new Date().toISOString(),
        })
        .eq('id', id);
      throwIfError(error, 'update run step');
    },

    async insertWait(input: InsertWaitInput) {
      const { data, error } = await db
        .from('automation_waits')
        .insert({
          account_id: input.accountId,
          run_id: input.runId,
          node_id: input.nodeId,
          resume_node_id: input.resumeNodeId,
          resume_at: input.resumeAt,
          kind: input.kind ?? 'time',
          correlation_key: input.correlationKey ?? null,
        })
        .select('*')
        .single();
      throwIfError(error, 'insert automation wait');
      return mapWait(data as Record<string, unknown>);
    },

    async claimDueWaits(limit) {
      const { data, error } = await db.rpc('claim_automation_waits', {
        p_limit: limit,
      });
      throwIfError(error, 'claim automation waits');
      return ((data ?? []) as Record<string, unknown>[]).map(mapWait);
    },

    async claimEventWait(args) {
      const { data, error } = await db.rpc('claim_event_wait', {
        p_account_id: args.accountId,
        p_correlation_key: args.correlationKey,
        p_automation_id: args.automationId,
      });
      throwIfError(error, 'claim event wait');
      const row = Array.isArray(data) ? data[0] : data;
      return row ? mapWait(row as Record<string, unknown>) : null;
    },

    async findEventWait(args) {
      const { data, error } = await db
        .from('automation_waits')
        .select('*')
        .eq('account_id', args.accountId)
        .eq('correlation_key', args.correlationKey)
        .eq('kind', 'event')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(error, 'find event wait');
      return data ? mapWait(data as Record<string, unknown>) : null;
    },

    async cancelWaitsForRun(runId) {
      const { error } = await db
        .from('automation_waits')
        .update({ status: 'cancelled' })
        .eq('run_id', runId)
        .in('status', ['pending', 'claimed']);
      throwIfError(error, 'cancel automation waits');
    },
  };
}

export function mapDomainEventRow(row: Record<string, unknown>): DomainEvent {
  return mapEventRow(row);
}
