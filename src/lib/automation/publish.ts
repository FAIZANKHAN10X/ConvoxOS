import { extractTrigger } from './graph';
import type { NodeRegistry } from './registry';
import type { AutomationStore } from './store';
import {
  AutomationPublishError,
  type Automation,
  type AutomationGraph,
} from './types';
import { validateGraph } from './validate';

export async function saveDraft(
  store: AutomationStore,
  automationId: string,
  graph: AutomationGraph
): Promise<Automation> {
  const trigger = extractTrigger(graph);
  return store.updateAutomation(automationId, {
    draftGraph: graph,
    draftTrigger: trigger,
  });
}

export async function publishAutomation(
  store: AutomationStore,
  registry: NodeRegistry,
  automationId: string,
  publishedBy: string | null
): Promise<Automation> {
  const automation = await store.getAutomation(automationId);
  if (!automation) throw new Error('automation not found');

  const issues = validateGraph(automation.draftGraph, registry);
  if (issues.length > 0) throw new AutomationPublishError(issues);

  const trigger = extractTrigger(automation.draftGraph);
  if (!trigger) {
    throw new AutomationPublishError([
      { path: 'graph', message: 'trigger required to publish' },
    ]);
  }

  const versionNumber = await store.nextVersionNumber(automationId);
  const version = await store.insertVersion({
    automationId,
    accountId: automation.accountId,
    versionNumber,
    graph: automation.draftGraph,
    trigger,
    publishedBy,
  });

  return store.updateAutomation(automationId, {
    status: 'published',
    publishedVersionId: version.id,
    draftTrigger: trigger,
  });
}

export async function disableAutomation(
  store: AutomationStore,
  automationId: string
): Promise<Automation> {
  return store.updateAutomation(automationId, { status: 'disabled' });
}

export async function enableAutomation(
  store: AutomationStore,
  automationId: string
): Promise<Automation> {
  const automation = await store.getAutomation(automationId);
  if (!automation) throw new Error('automation not found');
  if (!automation.publishedVersionId) {
    throw new Error(
      'cannot enable an automation that has never been published'
    );
  }
  return store.updateAutomation(automationId, { status: 'published' });
}
