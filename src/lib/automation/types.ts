import type { z } from 'zod';

export type AutomationStatus = 'draft' | 'published' | 'disabled';

export type RunStatus =
  'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export type StepStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export type WaitStatus = 'pending' | 'claimed' | 'cancelled';

export type DomainEventStatus =
  'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

export type DomainEventSource = 'crm' | 'automation';

export type NodeKind = 'trigger' | 'action' | 'condition' | 'wait';

export interface NodeHandleSpec {
  id: string;
  label: string;
}

export interface NodePorts {
  incoming: boolean;
  outgoing: NodeHandleSpec[];
}

export type NodeCategory =
  'trigger' | 'communication' | 'crm' | 'logic' | 'timing';

/**
 * Graph stored on drafts and published versions. Shape matches React
 * Flow JSON so the builder can persist the canvas without a second
 * model. The engine reads `data.config`; it does not import xyflow.
 */
export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { config: Record<string, unknown> };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface AutomationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TriggerSpec {
  type: string;
  config: Record<string, unknown>;
}

export interface DomainEvent {
  id: string;
  accountId: string;
  eventType: string;
  contactId: string | null;
  payload: Record<string, unknown>;
  source: DomainEventSource;
  originRunId: string | null;
  causationEventId: string | null;
  chainDepth: number;
  idempotencyKey: string;
  status: DomainEventStatus;
  attempts: number;
  availableAt: string;
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface NewDomainEvent {
  accountId: string;
  eventType: string;
  contactId?: string | null;
  payload?: Record<string, unknown>;
  source?: DomainEventSource;
  originRunId?: string | null;
  causationEventId?: string | null;
  chainDepth?: number;
  idempotencyKey: string;
  availableAt?: string;
}

export interface Automation {
  id: string;
  accountId: string;
  createdBy: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  draftGraph: AutomationGraph;
  draftTrigger: TriggerSpec | null;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationVersion {
  id: string;
  automationId: string;
  accountId: string;
  versionNumber: number;
  graph: AutomationGraph;
  trigger: TriggerSpec;
  publishedAt: string;
  publishedBy: string | null;
}

export interface AutomationRun {
  id: string;
  accountId: string;
  automationId: string;
  versionId: string;
  contactId: string;
  triggerEventId: string | null;
  status: RunStatus;
  currentNodeId: string | null;
  nodeExecutions: number;
  attempt: number;
  context: Record<string, unknown>;
  lastError: string | null;
  waitUntil: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RunStep {
  id: string;
  accountId: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  attempt: number;
  status: StepStatus;
  idempotencyKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AutomationWait {
  id: string;
  accountId: string;
  runId: string;
  nodeId: string;
  resumeNodeId: string | null;
  resumeAt: string;
  status: WaitStatus;
  claimedAt: string | null;
  createdAt: string;
}

export interface PublishedTrigger {
  automationId: string;
  accountId: string;
  versionId: string;
  trigger: TriggerSpec;
}

export type NodeResult =
  | { status: 'ok'; output?: Record<string, unknown> }
  | { status: 'wait'; waitUntil: string; output?: Record<string, unknown> }
  | { status: 'branch'; branch: string; output?: Record<string, unknown> }
  | { status: 'end'; output?: Record<string, unknown> }
  | { status: 'fail'; error: string; retryable?: boolean };

export interface ExecutionContext {
  accountId: string;
  contactId: string;
  runId: string;
  automationId: string;
  versionId: string;
  event: DomainEvent;
  vars: Record<string, unknown>;
  now: Date;
  /**
   * Account-scoped client. Nodes call existing CRM modules through
   * this rather than a service locator in the engine.
   */
  db: unknown;
}

export interface NodeDefinition<TConfig = unknown> {
  type: string;
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  /**
   * Connector contract. Defaults from kind when omitted: triggers have
   * no inbound and one Next; conditions have Yes/No; everything else
   * has one inbound and one Next.
   */
  ports?: NodePorts;
  summarize?(config: TConfig): string;
  /**
   * Presentation hint for the builder. Serialized into the catalog so
   * the canvas can render richer previews without node-type switches
   * in UI code. Currently supported: `preview: 'message'` renders the
   * node's `text` config as a chat bubble. Omit for default rendering.
   */
  preview?: 'message';
  validate?(config: TConfig, graph: AutomationGraph): string[];
  match?(event: DomainEvent, config: TConfig): boolean;
  execute?(
    ctx: ExecutionContext,
    config: TConfig
  ): Promise<NodeResult> | NodeResult;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class NodeExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'NodeExecutionError';
    this.retryable = retryable;
  }
}

export class AutomationPublishError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.name = 'AutomationPublishError';
    this.issues = issues;
  }
}
