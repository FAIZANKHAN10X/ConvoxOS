import type { z } from 'zod';

export type AutomationStatus = 'draft' | 'published' | 'disabled';

export type RunStatus =
  'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export type StepStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export type WaitStatus = 'pending' | 'claimed' | 'cancelled';

export type WaitKind = 'time' | 'event';

export type DomainEventStatus =
  'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

export type DomainEventSource = 'crm' | 'automation' | 'external';

export type NodeKind = 'trigger' | 'action' | 'condition' | 'wait';

export interface NodeHandleSpec {
  id: string;
  label: string;
  /**
   * Set for handles generated from node config (button rows,
   * randomizer variants). The canvas shows the handle's own label
   * instead of the node summary on such rows.
   */
  dynamic?: boolean;
}

export interface NodePorts {
  incoming: boolean;
  outgoing: NodeHandleSpec[];
}

export type NodeCategory =
  | 'trigger'
  | 'communication'
  | 'crm'
  | 'logic'
  | 'timing'
  | 'integration';

/**
 * A content block type a container node may hold (ManyChat block
 * model: text, image, button rows inside one message node). Blocks are
 * validated and edited generically; they never become graph nodes.
 */
export interface BlockDefinition {
  blockType: string;
  label: string;
  description?: string;
  configSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  fieldLabels?: Record<string, Record<string, string>>;
  emptyPrompt?: string;
  /**
   * Marks the block whose text previews the container on canvas and
   * in the phone mock (e.g. a text block's body). Generic: the UI
   * shows the first non-empty string of the first preview block.
   */
  preview?: boolean;
}

/** One block instance inside a container node's config array. */
export interface BlockInstance {
  id: string;
  blockType: string;
  config?: Record<string, unknown>;
}

/**
 * A named task a multi-action container can run (ManyChat action rows:
 * tag, set field, subscribe...). P0 validates task lists; execution
 * arrives with the container node.
 */
export interface TaskHandlerDef {
  taskType: string;
  label: string;
  description?: string;
  configSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  fieldLabels?: Record<string, Record<string, string>>;
}

/** One task item inside a container node's config array. */
export interface TaskItem {
  id: string;
  taskType: string;
  config?: Record<string, unknown>;
}

export interface NodeFlags {
  nondeterministic?: boolean;
  /** Node can be invoked from the builder without publishing a run. */
  testable?: boolean;
  pausesFlow?: boolean;
  /**
   * Container block types whose presence pauses the run (ManyChat:
   * a message with buttons pauses; text-only does not). Evaluated
   * against the node's own block array — no type switches.
   */
  pausesFlowBlocks?: string[];
}

/**
 * Declarative dynamic-port rule: one output handle per item of a
 * config array field (randomizer variants, button rows). Serializes
 * cleanly onto the catalog, unlike the `outputsFor` function.
 */
export interface DynamicPortRule {
  /**
   * Config array field with one output per item. Optional: when
   * omitted, ports are computed server-side by `outputsFor` and the
   * canvas renders the static base ports.
   */
  field?: string;
  idField?: string;
  labelField?: string;
  /**
   * Restrict to array items where `item[match.field] === match.equals`
   * (e.g. only `buttons` blocks inside a message `blocks` array).
   */
  match?: { field: string; equals: unknown };
  /**
   * Nested array field inside each matched item holding the rows
   * (e.g. `buttons` rows inside a buttons block). Dotted paths descend
   * (e.g. `config.buttons` reads each block's own config).
   */
  itemsField?: string;
  /**
   * Skip items where the field's presence matches (e.g. skip URL
   * buttons, which leave the flow instead of branching it).
   */
  skipWhen?: { field: string; present: boolean };
  /** Every generated handle must be wired for publish to succeed. */
  requireAll?: boolean;
  /**
   * Keep the static base outputs alongside generated ones (e.g. a
   * message keeps its default Next continuation plus per-button
   * branches). Defaults to false (generated handles replace base).
   */
  keepBase?: boolean;
}

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

/**
 * T5.4 enrollment controls. `repeat` enrolls whenever no active run
 * exists (historical behavior). `once` enrolls a contact at most
 * once ever — any prior run blocks re-enrollment.
 */
export type ReentryPolicy = 'once' | 'repeat';

export type EnrollmentSkipReason = 'active_run' | 'already_enrolled';

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
  reentryPolicy: ReentryPolicy;
  stopOnReply: boolean;
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
  kind: WaitKind;
  correlationKey: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface PublishedTrigger {
  automationId: string;
  accountId: string;
  versionId: string;
  trigger: TriggerSpec;
  /** T5.4: enrollment controls carried with the trigger so run
   * creation evaluates policy without extra reads (same freshness
   * guarantee as the version itself — the list query). */
  reentryPolicy: ReentryPolicy;
  stopOnReply: boolean;
  /**
   * Full published version carried with the trigger so run creation
   * does not re-read automation + version per match (T1.4: the old
   * path cost 2 extra reads per matched trigger on top of the 2
   * list queries per event). Freshness equals the list query itself
   * — same worker tick, and the list only selects published rows.
   */
  version: AutomationVersion;
}

export type NodeResult =
  | { status: 'ok'; output?: Record<string, unknown> }
  | {
      status: 'wait';
      waitUntil: string;
      waitKind?: WaitKind;
      output?: Record<string, unknown>;
    }
  | { status: 'branch'; branch: string; output?: Record<string, unknown> }
  | { status: 'end'; output?: Record<string, unknown> }
  | { status: 'fail'; error: string; retryable?: boolean };

export interface ExecutionContext {
  accountId: string;
  contactId: string;
  runId: string;
  /** Current graph node. Used to stabilize outbound Idempotency-Key. */
  nodeId?: string;
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
  /**
   * Runtime-configured outputs (e.g. randomizer variants, button rows).
   * Server-side override used by publish validation; the declarative
   * `dynamicPorts` rule below covers the cases the canvas must render.
   */
  outputsFor?(config: TConfig): NodePorts;
  summarize?(config: TConfig): string;
  /**
   * Presentation hint for the builder. Serialized into the catalog so
   * the canvas can render richer previews without node-type switches
   * in UI code. Currently supported: `preview: 'message'` renders the
   * node's `text` config as a chat bubble. Omit for default rendering.
   */
  preview?: 'message';
  /**
   * Human labels for enum config values, keyed by field then value.
   * Copied onto the catalog so the picker/editor never switch on type.
   */
  fieldLabels?: Record<string, Record<string, string>>;
  /** Canvas empty-state copy when required config is missing. */
  emptyPrompt?: string;
  /** Show a config field only when another field is one of `values`. */
  fieldWhen?: Record<string, { field: string; values: string[] }>;
  /**
   * Content blocks this node can contain (ManyChat message-container
   * model). Blocks are data inside the node config — not graph rows,
   * not registry nodes — so engine, ports, and versioning stay flat.
   * Stored under `blockField` (default `blocks`) as BlockInstance[].
   */
  blocks?: BlockDefinition[];
  /** Config key holding the BlockInstance array. Defaults to `blocks`. */
  blockField?: string;
  /**
   * Declarative per-item output rule, serialized onto the catalog so
   * the canvas can render runtime ports without node-type switches.
   * `outputsFor` (above) takes precedence server-side when both exist.
   */
  dynamicPorts?: DynamicPortRule;
  /**
   * Named task palette for multi-action containers. Stored under
   * `taskField` (default `tasks`) as TaskItem[]. Tasks are validated
   * here; a container node executes them in a later wave.
   */
  tasks?: TaskHandlerDef[];
  /** Config key holding the TaskItem array. Defaults to `tasks`. */
  taskField?: string;
  /**
   * Execution hints. `pausesFlow` marks nodes that break a no-pause
   * run (buttons, delays) for the 30-block pause accounting.
   * `nondeterministic` marks AI-style steps for preview/stats rules.
   */
  flags?: NodeFlags;
  validate?(config: TConfig, graph: AutomationGraph): string[];
  match?(
    event: DomainEvent,
    config: TConfig,
    ctx?: { automationId: string }
  ): boolean;
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
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    retryable = false,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'NodeExecutionError';
    this.retryable = retryable;
    this.details = details;
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
