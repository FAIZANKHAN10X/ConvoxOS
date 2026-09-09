import { registerNode } from '../registry';
import type { NodeDefinition } from '../types';

import { addTagAction } from './add-tag';
import { conditionNode } from './condition';
import { sendTextAction } from './send-text';
import { tagAddedTrigger } from './tag-added';
import { waitNode } from './wait';

export { tagAddedTrigger } from './tag-added';
export { sendTextAction } from './send-text';
export { addTagAction } from './add-tag';
export { waitNode } from './wait';
export { conditionNode } from './condition';

/**
 * Built-in Wave-0 nodes. Additional nodes register themselves the same
 * way: define, then `registerNode()`. This file is the only place the
 * catalog is assembled for builtins — not the engine or builder.
 */
export const builtinNodes: NodeDefinition[] = [
  tagAddedTrigger,
  sendTextAction,
  addTagAction,
  waitNode,
  conditionNode,
];

for (const node of builtinNodes) {
  registerNode(node);
}
