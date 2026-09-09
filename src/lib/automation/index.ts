/**
 * Automation engine (v2).
 *
 * Developer workflow for node #50:
 *   1. Define a NodeDefinition (type, kind, configSchema, execute/match)
 *   2. Register it with registerNode()
 *   3. Builder, validator, and engine discover it from the registry
 *
 * Do not add a switch on node type in the engine.
 */
import './nodes';

export {
  MAX_EVENT_CHAIN_DEPTH,
  MAX_NODE_EXECUTIONS_PER_INVOCATION,
  MAX_NODE_EXECUTIONS_PER_RUN,
} from './constants';
export { defaultRegistry, NodeRegistry, registerNode } from './registry';
export { createMemoryStore } from './memory-store';
export { createPostgresStore } from './postgres-store';
export { enqueueDomainEvent, enqueueDomainEventWithClient } from './events';
export { DOMAIN_EVENT } from './event-types';
export { kickDomainEvent, kickAutomationWorker } from './kick';
export {
  emitContactCreated,
  emitMessageReceived,
  emitTaskCreated,
  emitTaskCompleted,
} from './crm-events';
export { matchTriggers } from './match';
export { executeRun, createRunFromMatch, cancelRun } from './engine';
export { runAutomationWorker, processDomainEvent } from './worker';
export {
  saveDraft,
  publishAutomation,
  disableAutomation,
  enableAutomation,
} from './publish';
export { validateGraph } from './validate';
export { graphFromNodes, emptyGraph, starterGraph } from './graph';
export { builtinNodes } from './nodes';
export { catalogFromRegistry } from './catalog';
export type { CatalogNode } from './catalog';
export { resolvePorts, defaultPorts } from './ports';
export { matchKeywords } from './keywords';
export { registerPredicate, listPredicates, getPredicate } from './predicates';
export { mapAutomation, mapRun, mapStep } from './postgres-store';
export { AutomationPublishError } from './types';
export { createEngineDeps } from './deps';
export type { EngineDeps } from './engine';
export type { AutomationStore } from './store';
export type {
  AutomationGraph,
  DomainEvent,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from './types';
