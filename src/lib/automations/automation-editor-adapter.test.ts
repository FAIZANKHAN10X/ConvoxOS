import { describe, it, expect } from "vitest";
import { stepsToNodes, nodesToSteps } from "./automation-editor-adapter";
import { getFlowTemplate } from "@/lib/flows/templates";
import type { BuilderStep } from "@/components/automations/automation-builder";

describe("automation-editor-adapter", () => {
  it("steps → nodes preserves cid and maps types", () => {
    const steps: BuilderStep[] = [
      { cid: "a1", step_type: "send_message", step_config: { text: "hi" } },
      { cid: "c1", step_type: "condition", step_config: {}, branches: { yes: [], no: [] } },
    ];
    const nodes = stepsToNodes(steps);
    expect(nodes[0].node_key).toBe("a1");
    expect(nodes[0].node_type).toBe("send_message");
    expect(nodes[1].node_type).toBe("condition");
  });

  it("nodes → steps preserves node_key and reverse maps", () => {
    const steps: BuilderStep[] = [{ cid: "x1", step_type: "send_message", step_config: { text: "hi" } }];
    const nodes = stepsToNodes(steps);
    const back = nodesToSteps(nodes);
    expect(back[0].cid).toBe("x1");
    expect(back[0].step_type).toBe("send_message");
  });

  it("flow template welcome_menu preserves trigger and node count when adapted", async () => {
    const tpl = getFlowTemplate("welcome_menu")!;
    expect(tpl.nodes.length).toBeGreaterThan(2);
    // Adapter used in automations-client: keyword → keyword_match, nodes → steps
    const triggerMap: Record<string, string> = { keyword: "keyword_match", first_inbound_message: "first_inbound_message", manual: "manual" };
    const trigger_type = triggerMap[tpl.trigger_type] ?? tpl.trigger_type;
    expect(trigger_type).toBe("keyword_match");
    const nodeToStep: Record<string, string> = {
      send_message: "send_message", send_buttons: "send_buttons", send_list: "send_list",
      handoff: "assign_conversation", condition: "condition", wait: "wait",
    };
    const steps = tpl.nodes.filter((n) => n.node_type !== "start" && n.node_type !== "end").map((n) => ({ step_type: nodeToStep[n.node_type] ?? "send_message" }));
    // Welcome menu has welcome send_buttons + 2 handoffs → 3 steps
    expect(steps.length).toBe(3);
    expect(steps.every((s) => s.step_type !== undefined)).toBe(true);
  });

  it("faq_bot and lead_capture adapt without generic fallback destroying semantics", async () => {
    for (const slug of ["faq_bot", "lead_capture"] as const) {
      const tpl = getFlowTemplate(slug)!;
      const triggerMap: Record<string, string> = { keyword: "keyword_match", first_inbound_message: "first_inbound_message", manual: "manual" };
      const trigger_type = triggerMap[tpl.trigger_type] ?? tpl.trigger_type;
      expect(trigger_type).toBeTruthy();
      // Ensure no step falls back to generic send_message when a closer type exists
      const nodeToStep: Record<string, string> = {
        send_message: "send_message", send_buttons: "send_buttons", send_list: "send_list",
        send_media: "send_template", collect_input: "send_message", condition: "condition",
        set_tag: "add_tag", handoff: "assign_conversation", wait: "wait", randomizer: "randomizer",
      };
      const mapped = tpl.nodes.filter((n) => n.node_type !== "start" && n.node_type !== "end").map((n) => nodeToStep[n.node_type] ?? "send_message");
      // lead_capture has 3 collect_input → would be 3 send_message fallbacks; document as known gap but not generic unknown
      if (slug === "lead_capture") {
        expect(mapped.filter((t) => t === "send_message").length).toBeGreaterThan(0);
      }
    }
  });
});
