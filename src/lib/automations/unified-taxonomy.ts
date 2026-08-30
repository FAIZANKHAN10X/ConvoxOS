/**
 * Unified Automation Taxonomy — vocabulary shared by Flows + Automations product.
 *
 * Provides one category set + one primitive list so the Add-step pickers
 * in both editors render the same mental model even while persistence
 * (FlowNodeType vs AutomationStepType) remains separate behind adapters.
 *
 * Do NOT invent provider factories here — ChannelSocket stays thin
 * (src/lib/channels/socket.ts:1).
 */

import {
  Flag,
  GitFork,
  Hourglass,
  Inbox,
  ListPlus,
  ListChecks,
  MessageCircle,
  Paperclip,
  Tag,
  FileText,
  UserPlus,
  Users,
  PencilLine,
  Briefcase,
  Webhook,
  CircleSlash,
} from "lucide-react"

export type UnifiedCategory =
  | "communication"
  | "input"
  | "logic"
  | "timing"
  | "crm"
  | "integration"
  | "control"

export interface CategoryMeta {
  id: UnifiedCategory
  label: string
  order: number
}

export const UNIFIED_CATEGORIES: CategoryMeta[] = [
  { id: "communication", label: "Communication", order: 0 },
  { id: "input", label: "Input", order: 1 },
  { id: "logic", label: "Logic", order: 2 },
  { id: "timing", label: "Timing", order: 3 },
  { id: "crm", label: "CRM", order: 4 },
  { id: "integration", label: "Integration", order: 5 },
  { id: "control", label: "Control", order: 6 },
]

export type UnifiedPrimitiveId =
  // Communication
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_media"
  | "send_template"
  // Input
  | "collect_input"
  // Logic
  | "condition"
  // Timing
  | "wait"
  // CRM
  | "tag"
  | "update_contact"
  | "create_deal"
  | "assign_conversation"
  | "handoff"
  | "close_conversation"
  // Integration
  | "webhook"
  // Control
  | "end"

export interface PrimitiveMeta {
  id: UnifiedPrimitiveId
  label: string
  blurb: string
  icon: typeof MessageCircle
  category: UnifiedCategory
  /** Which persistence currently implements it */
  hosts: ("flow" | "automation")[]
  /** Visible in Add picker (false hides internal like start) */
  picker: boolean
}

export const UNIFIED_PRIMITIVES: PrimitiveMeta[] = [
  { id: "send_message", label: "Message", blurb: "Sends a text message", icon: MessageCircle, category: "communication", hosts: ["flow", "automation"], picker: true },
  { id: "send_buttons", label: "Buttons", blurb: "Sends quick-reply buttons", icon: ListChecks, category: "communication", hosts: ["flow", "automation"], picker: true },
  { id: "send_list", label: "List", blurb: "Sends a tappable list", icon: ListPlus, category: "communication", hosts: ["flow", "automation"], picker: true },
  { id: "send_media", label: "Media", blurb: "Image, video, or document", icon: Paperclip, category: "communication", hosts: ["flow"], picker: true },
  { id: "send_template", label: "Template", blurb: "Approved WhatsApp template", icon: FileText, category: "communication", hosts: ["automation"], picker: true },
  { id: "collect_input", label: "Collect Input", blurb: "Ask, save reply → vars", icon: Inbox, category: "input", hosts: ["flow"], picker: true },
  { id: "condition", label: "Condition", blurb: "Branch yes / no", icon: GitFork, category: "logic", hosts: ["flow", "automation"], picker: true },
  { id: "wait", label: "Wait", blurb: "Pause minutes / hours / days", icon: Hourglass, category: "timing", hosts: ["automation"], picker: true },
  { id: "tag", label: "Tag", blurb: "Add or remove tag", icon: Tag, category: "crm", hosts: ["flow", "automation"], picker: true },
  { id: "update_contact", label: "Update Contact", blurb: "Set contact field / custom", icon: PencilLine, category: "crm", hosts: ["automation"], picker: true },
  { id: "create_deal", label: "Create Deal", blurb: "New pipeline deal", icon: Briefcase, category: "crm", hosts: ["automation"], picker: true },
  { id: "assign_conversation", label: "Assign", blurb: "Assign to agent / round-robin", icon: Users, category: "crm", hosts: ["automation"], picker: true },
  { id: "handoff", label: "Handoff", blurb: "Hand to human", icon: UserPlus, category: "crm", hosts: ["flow"], picker: true },
  { id: "close_conversation", label: "Close Conversation", blurb: "Mark closed", icon: CircleSlash, category: "crm", hosts: ["automation"], picker: true },
  { id: "webhook", label: "Webhook", blurb: "POST JSON", icon: Webhook, category: "integration", hosts: ["automation"], picker: true },
  { id: "end", label: "End", blurb: "Ends automation", icon: Flag, category: "control", hosts: ["flow"], picker: true },
]

export function groupUnifiedByCategory(
  ids: UnifiedPrimitiveId[],
): { id: UnifiedCategory; label: string; items: PrimitiveMeta[] }[] {
  return UNIFIED_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    items: ids
      .map((id) => UNIFIED_PRIMITIVES.find((p) => p.id === id)!)
      .filter((p) => p.category === c.id),
  })).filter((g) => g.items.length > 0)
}

// Adapters — map tag primitive modes between Flow (set_tag) and Automation (add_tag/remove_tag)
export type TagMode = "add" | "remove"
export function flowTagModeToUnified(mode: string | undefined): TagMode {
  return mode === "remove" ? "remove" : "add"
}
export function unifiedTagModeToFlowMode(mode: TagMode): "add" | "remove" {
  return mode
}
export function unifiedTagToAutomationStep(mode: TagMode): "add_tag" | "remove_tag" {
  return mode === "remove" ? "remove_tag" : "add_tag"
}
export function automationStepToTagMode(step: "add_tag" | "remove_tag"): TagMode {
  return step === "remove_tag" ? "remove" : "add"
}

// Host helpers — where a primitive currently persists
export function hostsOf(id: UnifiedPrimitiveId): ("flow" | "automation")[] {
  return UNIFIED_PRIMITIVES.find((p) => p.id === id)?.hosts ?? []
}
export function isImplementedIn(id: UnifiedPrimitiveId, host: "flow" | "automation"): boolean {
  return hostsOf(id).includes(host)
}
