/**
 * Builtin node barrel. Implementations live in `./nodes/` so a new
 * node is one file + `registerNode()` — never an engine/builder switch.
 */
export {
  addTagAction,
  builtinNodes,
  conditionNode,
  sendTextAction,
  tagAddedTrigger,
  waitNode,
} from './nodes/index';
