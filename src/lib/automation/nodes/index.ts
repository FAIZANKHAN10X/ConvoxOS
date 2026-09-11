import { registerNode } from '../registry';
import type { NodeDefinition } from '../types';

import { addTagAction } from './add-tag';
import { assignOwnerAction } from './assign-owner';
import { conditionNode } from './condition';
import { dealStageChangedTrigger } from './deal-stage-changed';
import { moveDealAction } from './move-deal';
import { contactCreatedTrigger } from './contact-created';
import { inboundWebhookTrigger } from './inbound-webhook';
import { httpRequestAction } from './http-request';
import { n8nWorkflowAction } from './n8n-workflow';
import { keywordTrigger } from './keyword';
import { messageReceivedTrigger } from './message-received';
import { messageNode } from './message';
import { removeTagAction } from './remove-tag';
import { sendTextAction } from './send-text';
import { tagAddedTrigger } from './tag-added';
import { completeTaskAction, createTaskAction } from './tasks';
import { tagRemovedTrigger } from './tag-removed';
import { waitNode } from './wait';
import { waitExternalNode } from './wait-external';

export { completeTaskAction, createTaskAction } from './tasks';
export { tagAddedTrigger } from './tag-added';
export { tagRemovedTrigger } from './tag-removed';
export { messageReceivedTrigger } from './message-received';
export { messageNode } from './message';
export { keywordTrigger } from './keyword';
export { contactCreatedTrigger } from './contact-created';
export { inboundWebhookTrigger } from './inbound-webhook';
export { httpRequestAction } from './http-request';
export { sendTextAction } from './send-text';
export { addTagAction } from './add-tag';
export { removeTagAction } from './remove-tag';
export { waitNode } from './wait';
export { waitExternalNode } from './wait-external';
export { assignOwnerAction } from './assign-owner';
export { conditionNode } from './condition';
export { dealStageChangedTrigger } from './deal-stage-changed';
export { moveDealAction } from './move-deal';
export { n8nWorkflowAction } from './n8n-workflow';

export const builtinNodes: NodeDefinition[] = [
  messageReceivedTrigger,
  keywordTrigger,
  tagAddedTrigger,
  tagRemovedTrigger,
  contactCreatedTrigger,
  dealStageChangedTrigger,
  inboundWebhookTrigger,
  httpRequestAction,
  n8nWorkflowAction,
  sendTextAction,
  messageNode,
  addTagAction,
  removeTagAction,
  moveDealAction,
  createTaskAction,
  completeTaskAction,
  assignOwnerAction,
  waitNode,
  waitExternalNode,
  conditionNode,
];

for (const node of builtinNodes) {
  registerNode(node);
}
