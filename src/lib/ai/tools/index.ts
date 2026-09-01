import { createRegistry } from './registry';
import { getContactTool, updateContactTool, addTagTool, removeTagTool, updateCustomFieldTool } from './crm';
import { createDealTool, moveDealStageTool } from './deals';
import { searchKnowledgeTool } from './knowledge';
import { sendMessageTool } from './messaging';
import { handoffTool } from './handoff';
import { triggerAutomationTool } from './automation';

export function createAgentTools() {
  const registry = createRegistry();
  registry.register(getContactTool);
  registry.register(updateContactTool);
  registry.register(addTagTool);
  registry.register(removeTagTool);
  registry.register(updateCustomFieldTool);
  registry.register(createDealTool);
  registry.register(moveDealStageTool);
  registry.register(searchKnowledgeTool);
  registry.register(sendMessageTool);
  registry.register(handoffTool);
  registry.register(triggerAutomationTool);
  return registry;
}

export type AgentToolRegistry = ReturnType<typeof createAgentTools>;
