import type { BuilderStep } from "@/components/automations/automation-builder"
import type { BuilderNode } from "@/components/flows/shared"

export type PreviewStep = { label: string; detail?: string }

export function previewAutomationSteps(steps: BuilderStep[]): PreviewStep[] {
  const out: PreviewStep[] = []
  function walk(list: BuilderStep[]) {
    for (const s of list) {
      if (s.step_type === "send_message") {
        const cfg = s.step_config as { text?: string; channel_target?: string }
        const ch = (cfg.channel_target as string) ?? "whatsapp"
        if (ch === "current") out.push({ label: "Send Message", detail: "Current channel unavailable for this trigger" })
        else out.push({ label: "Send Message", detail: `via ${ch}` })
      } else if (s.step_type === "send_buttons" || s.step_type === "send_list") {
        const ch = ((s.step_config as unknown as { channel_target?: string }).channel_target as string) ?? "whatsapp"
        out.push({ label: s.step_type === "send_buttons" ? "Send Buttons" : "Send List", detail: `via ${ch}` })
      } else if (s.step_type === "send_template") out.push({ label: "Send Template", detail: "via whatsapp" })
      else if (s.step_type === "wait") {
        const c = s.step_config as { amount?: number; unit?: string }
        out.push({ label: "Wait", detail: `${c.amount ?? 1} ${c.unit ?? "hours"}` })
      } else if (s.step_type === "condition") {
        const c = s.step_config as { subject?: string; operand?: string; value?: string }
        if (!c.subject || !c.operand) out.push({ label: "Condition → Requires runtime data", detail: `${c.subject ?? "?"} ${c.operand ?? ""}` })
        else out.push({ label: "Condition", detail: `${c.subject} ${c.operand}${c.value ? `=${c.value}` : ""} → YES/NO` })
        const yes = s.branches?.yes ?? []
        const no = s.branches?.no ?? []
        if (yes.length) { out.push({ label: "↳ YES branch" }); walk(yes) }
        if (no.length) { out.push({ label: "↳ NO branch" }); walk(no) }
      } else if (s.step_type === "add_tag" || s.step_type === "remove_tag") out.push({ label: s.step_type === "add_tag" ? "Add Tag" : "Remove Tag" })
      else if (s.step_type === "update_contact_field") out.push({ label: "Update Contact" })
      else if (s.step_type === "create_deal") out.push({ label: "Create Deal" })
      else if (s.step_type === "assign_conversation") out.push({ label: "Assign Conversation" })
      else if (s.step_type === "send_webhook") {
        const url = (s.step_config as { url?: string }).url
        out.push({ label: "Webhook", detail: url ? new URL(url).hostname : "no url" })
      } else if (s.step_type === "close_conversation") out.push({ label: "Close Conversation" })
    }
  }
  walk(steps)
  return out
}

export function previewFlowNodes(nodes: BuilderNode[]): PreviewStep[] {
  return nodes.map((n) => {
    const cfg = n.config as Record<string, unknown>
    const ch = (cfg.channel_target as string) ?? "current"
    if (n.node_type === "wait") return { label: "Wait", detail: `${String(cfg.amount ?? 1)} ${String(cfg.unit ?? "hours")}` }
    if (n.node_type === "condition") {
      const subj = String(cfg.subject ?? "?")
      const key = String(cfg.subject_key ?? "?")
      const op = String(cfg.operator ?? "?")
      return { label: "Condition", detail: `${subj}:${key} ${op} → YES/NO` }
    }
    if (n.node_type.startsWith("send_") || n.node_type === "collect_input") {
      if (ch === "current") return { label: n.node_type, detail: "via current (requires conversational context)" }
      return { label: n.node_type, detail: `via ${ch}` }
    }
    return { label: n.node_type }
  })
}
