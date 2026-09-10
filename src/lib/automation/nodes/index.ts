import { registerNode } from '../registry';
import type { NodeDefinition } from '../types';

import { addTagAction } from './add-tag';
import { conditionNode } from './condition';
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
import { tagRemovedTrigger } from './tag-removed';
import { waitNode } from './wait';

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
export { conditionNode } from './condition';
export { n8nWorkflowAction } from './n8n-workflow';

export const builtinNodes: NodeDefinition[] = [
  messageReceivedTrigger,
  keywordTrigger,
  tagAddedTrigger,
  tagRemovedTrigger,
  contactCreatedTrigger,
  inboundWebhookTrigger,
  httpRequestAction,
  n8nWorkflowAction,
  sendTextAction,
  messageNode,
  addTagAction,
  removeTagAction,
  waitNode,
  conditionNode,
];

for (const node of builtinNodes) {
  registerNode(node);
}
