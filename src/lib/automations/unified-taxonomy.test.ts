import { describe, it, expect } from "vitest"
import {
  UNIFIED_PRIMITIVES,
  groupUnifiedByCategory,
  flowTagModeToUnified,
  unifiedTagModeToFlowMode,
  unifiedTagToAutomationStep,
  automationStepToTagMode,
  isImplementedIn,
} from "./unified-taxonomy"

describe("unified-taxonomy", () => {
  it("covers all known primitives without duplicate ids", () => {
    const ids = UNIFIED_PRIMITIVES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it("groups by category preserving order", () => {
    const ids = ["send_message", "collect_input", "condition", "wait", "tag", "webhook", "end"] as const
    const groups = groupUnifiedByCategory([...ids])
    expect(groups.map((g) => g.id)).toEqual(["communication", "input", "logic", "timing", "crm", "integration", "control"].filter((c) => groups.some((g) => g.id === c)))
  })
  it("maps tag modes flow↔unified↔automation", () => {
    expect(flowTagModeToUnified("add")).toBe("add")
    expect(flowTagModeToUnified("remove")).toBe("remove")
    expect(flowTagModeToUnified(undefined)).toBe("add")
    expect(unifiedTagModeToFlowMode("add")).toBe("add")
    expect(unifiedTagToAutomationStep("add")).toBe("add_tag")
    expect(unifiedTagToAutomationStep("remove")).toBe("remove_tag")
    expect(automationStepToTagMode("add_tag")).toBe("add")
    expect(automationStepToTagMode("remove_tag")).toBe("remove")
  })
  it("reports hosts correctly", () => {
    expect(isImplementedIn("send_message", "flow")).toBe(true)
    expect(isImplementedIn("send_message", "automation")).toBe(true)
    expect(isImplementedIn("wait", "flow")).toBe(false)
    expect(isImplementedIn("wait", "automation")).toBe(true)
    expect(isImplementedIn("collect_input", "flow")).toBe(true)
    expect(isImplementedIn("webhook", "flow")).toBe(false)
  })
})
