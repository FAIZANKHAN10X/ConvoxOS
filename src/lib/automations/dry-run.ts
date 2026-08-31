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
        if (ch === "current") out.push({ label: "Send Message", detail: "Current channel unavailable for this trigger [SIMULATED]" })
        else out.push({ label: "Send Message", detail: `via ${ch} [SIMULATED]` })
      } else if (s.step_type === "send_buttons" || s.step_type === "send_list") {
        const ch = ((s.step_config as unknown as { channel_target?: string }).channel_target as string) ?? "whatsapp"
        out.push({ label: s.step_type === "send_buttons" ? "Send Buttons" : "Send List", detail: `via ${ch} [SIMULATED]` })
      } else if (s.step_type === "send_template") out.push({ label: "Send Template", detail: "via whatsapp [SIMULATED]" })
      else if (s.step_type === "wait") {
        const c = s.step_config as { amount?: number; unit?: string; until?: string }
        if (c.until) out.push({ label: "Wait", detail: `until ${new Date(c.until).toLocaleString()} [SIMULATED]` })
        else out.push({ label: "Wait", detail: `${c.amount ?? 1} ${c.unit ?? "hours"} [SIMULATED]` })
      } else if (s.step_type === "condition") {
        const c = s.step_config as { subject?: string; operand?: string; value?: string; conditions?: unknown[]; match?: string }
        if (c.conditions && Array.isArray(c.conditions) && c.conditions.length > 0) {
          out.push({ label: "Condition", detail: `${c.conditions.length} conditions ${c.match ?? 'all'} [SIMULATED → YES/NO]` })
        } else if (!c.subject || !c.operand) out.push({ label: "Condition → Requires runtime data", detail: `${c.subject ?? "?"} ${c.operand ?? ""} [SIMULATED]` })
        else out.push({ label: "Condition", detail: `${c.subject} ${c.operand}${c.value ? `=${c.value}` : ""} → YES/NO [SIMULATED]` })
        const yes = s.branches?.yes ?? []
        const no = s.branches?.no ?? []
        if (yes.length) { out.push({ label: "↳ YES branch" }); walk(yes) }
        if (no.length) { out.push({ label: "↳ NO branch" }); walk(no) }
      } else if (s.step_type === "randomizer") {
        const c = s.step_config as { variants?: Array<{ label: string }> }
        out.push({ label: "Randomizer", detail: `${c.variants?.length ?? 0} ways [SIMULATED deterministic]` })
      } else if (s.step_type === "goal") {
        const c = s.step_config as { condition?: { subject?: string } }
        out.push({ label: "Goal", detail: `${c.condition?.subject ?? "?"} [SIMULATED wait]` })
      } else if (s.step_type === "enroll_in_sequence") {
        out.push({ label: "Enroll in Sequence", detail: `${(s.step_config as { sequence_id?: string }).sequence_id?.slice(0, 8) ?? "?"} [SIMULATED]` })
      } else if (s.step_type === "add_tag" || s.step_type === "remove_tag") out.push({ label: s.step_type === "add_tag" ? "Add Tag" : "Remove Tag", detail: "[SIMULATED]" })
      else if (s.step_type === "update_contact_field") out.push({ label: "Update Contact", detail: "[SIMULATED]" })
      else if (s.step_type === "create_deal") out.push({ label: "Create Deal", detail: "[SIMULATED]" })
      else if (s.step_type === "create_task") out.push({ label: "Create Task", detail: "[SIMULATED]" })
      else if (s.step_type === "assign_conversation") out.push({ label: "Assign Conversation", detail: "[SIMULATED]" })
      else if (s.step_type === "send_webhook") {
        const cfg = s.step_config as { url?: string; method?: string }
        const m = (cfg.method ?? 'POST')
        const url = cfg.url ? (() => { try { return new URL(cfg.url).hostname } catch { return cfg.url } })() : "no url"
        out.push({ label: "Webhook", detail: `${m} ${url} [SIMULATED, no network]` })
      } else if (s.step_type === "close_conversation") out.push({ label: "Close Conversation", detail: "[SIMULATED]" })
    }
  }
  walk(steps)
  return out
}

export function previewFlowNodes(nodes: BuilderNode[]): PreviewStep[] {
  return nodes.map((n) => {
    const cfg = n.config as Record<string, unknown>
    const ch = (cfg.channel_target as string) ?? "current"
    if (n.node_type === "wait") {
      const until = cfg.until as string | undefined
      if (until) return { label: "Wait", detail: `until ${new Date(until).toLocaleString()} [SIMULATED]` }
      return { label: "Wait", detail: `${String(cfg.amount ?? 1)} ${String(cfg.unit ?? "hours")} [SIMULATED]` }
    }
    if (n.node_type === "condition") {
      const hasMulti = Array.isArray(cfg.conditions) && (cfg.conditions as unknown[]).length > 0
      if (hasMulti) {
        const count = (cfg.conditions as unknown[]).length
        const match = String(cfg.match ?? 'all')
        return { label: "Condition", detail: `${count} conditions ${match} → YES/NO [SIMULATED]` }
      }
      const subj = String(cfg.subject ?? "?")
      const key = String(cfg.subject_key ?? "?")
      const op = String(cfg.operator ?? "?")
      return { label: "Condition", detail: `${subj}:${key} ${op} → YES/NO [SIMULATED]` }
    }
    if (n.node_type === "randomizer") {
      const variants = Array.isArray(cfg.variants) ? cfg.variants as Array<Record<string, unknown>> : []
      return { label: "Randomizer", detail: `${variants.length} ways [SIMULATED deterministic]` }
    }
    if (n.node_type === "handoff" || n.node_type === "end") return { label: n.node_type, detail: "[SIMULATED]" }
    if (n.node_type.startsWith("send_") || n.node_type === "collect_input") {
      if (ch === "current") return { label: n.node_type, detail: "via current (requires conversational context) [SIMULATED]" }
      return { label: n.node_type, detail: `via ${ch} [SIMULATED]` }
    }
    return { label: n.node_type, detail: "[SIMULATED]" }
  })
}
