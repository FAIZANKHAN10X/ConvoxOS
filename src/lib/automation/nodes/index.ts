import { registerNode } from '../registry';
import type { NodeDefinition } from '../types';

import { addTagAction } from './add-tag';
import { conditionNode } from './condition';
import { contactCreatedTrigger } from './contact-created';
import { keywordTrigger } from './keyword';
import { messageReceivedTrigger } from './message-received';
import { removeTagAction } from './remove-tag';
import { sendTextAction } from './send-text';
import { tagAddedTrigger } from './tag-added';
import { tagRemovedTrigger } from './tag-removed';
import { waitNode } from './wait';

export { tagAddedTrigger } from './tag-added';
export { tagRemovedTrigger } from './tag-removed';
export { messageReceivedTrigger } from './message-received';
export { keywordTrigger } from './keyword';
export { contactCreatedTrigger } from './contact-created';
export { sendTextAction } from './send-text';
export { addTagAction } from './add-tag';
export { removeTagAction } from './remove-tag';
export { waitNode } from './wait';
export { conditionNode } from './condition';

export const builtinNodes: NodeDefinition[] = [
  messageReceivedTrigger,
  keywordTrigger,
  tagAddedTrigger,
  tagRemovedTrigger,
  contactCreatedTrigger,
  sendTextAction,
  addTagAction,
  removeTagAction,
  waitNode,
  conditionNode,
];

for (const node of builtinNodes) {
  registerNode(node);
}
