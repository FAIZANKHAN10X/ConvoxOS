/**
 * Minimal adapter for Phase 1 of Automation UX unification.
 *
 * Maps Automation steps (flat parent_index/branch) ↔ Flow BuilderNode
 * graph so the Flow canvas can render automations and vice versa.
 * Full taxonomy merge is deferred (audit §13), but this adapter is
 * the product-layer seam that stops template from choosing storage.
 *
 * Automations table remains canonical; Flows rows are read-only legacy
 * via this adapter until storage migration.
 */

import type { BuilderStep } from "@/components/automations/automation-builder"
import type { BuilderNode, NodeType } from "@/components/flows/shared"

// Step type → NodeType where overlap exists; otherwise map to closest
const STEP_TO_NODE: Partial<Record<string, NodeType>> = {
  send_message: "send_message",
  send_buttons: "send_buttons",
  send_list: "send_list",
  send_template: "send_message", // closest messaging
  condition: "condition",
  wait: "wait",
  randomizer: "randomizer",
  set_tag: "set_tag",
  // add_tag/remove_tag → set_tag, assign_conversation → handoff, etc.
  add_tag: "set_tag",
  remove_tag: "set_tag",
  assign_conversation: "handoff",
  update_contact_field: "collect_input",
  create_deal: "handoff",
  create_task: "handoff",
  enroll_in_sequence: "handoff",
  send_webhook: "handoff",
  close_conversation: "end",
  goal: "condition",
}

export function stepsToNodes(steps: BuilderStep[]): BuilderNode[] {
  return steps.map((s, i) => ({
    node_key: s.cid,
    node_type: (STEP_TO_NODE[s.step_type] ?? "send_message") as NodeType,
    config: s.step_config,
    position_x: 0,
    position_y: i * 140,
  }))
}

export function nodesToSteps(nodes: BuilderNode[]): BuilderStep[] {
  // Reverse: nodes back to steps (Basic ↔ Flow toggle). Preserve cid=node_key.
  return nodes.map((n) => ({
    cid: n.node_key,
    step_type: (Object.entries(STEP_TO_NODE).find(([, v]) => v === n.node_type)?.[0] ?? "send_message") as BuilderStep["step_type"],
    step_config: n.config,
    branches: n.node_type === "condition" ? { yes: [], no: [] } : undefined,
  }))
}
