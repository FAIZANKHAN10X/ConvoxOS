import { describe, it, expect } from "vitest"
import { evaluateConditionPredicate } from "./engine"
import { validateFlowForActivation } from "./validate"
import { deriveCanvasEdges } from "./edges"
import type { BuilderNode } from "@/components/flows/shared"

describe("Flow condition — predicate", () => {
  it("present/absent", () => {
    expect(evaluateConditionPredicate({ operator: "present", subjectValue: "x", configValue: undefined })).toBe(true)
    expect(evaluateConditionPredicate({ operator: "present", subjectValue: undefined, configValue: undefined })).toBe(false)
    expect(evaluateConditionPredicate({ operator: "absent", subjectValue: undefined, configValue: undefined })).toBe(true)
  })
  it("equals/contains", () => {
    expect(evaluateConditionPredicate({ operator: "equals", subjectValue: "hello", configValue: "hello" })).toBe(true)
    expect(evaluateConditionPredicate({ operator: "equals", subjectValue: "hello", configValue: "hi" })).toBe(false)
    expect(evaluateConditionPredicate({ operator: "contains", subjectValue: "hello world", configValue: "world" })).toBe(true)
    expect(evaluateConditionPredicate({ operator: "contains", subjectValue: undefined, configValue: "x" })).toBe(false)
  })
})

describe("Flow condition — validation binary YES/NO", () => {
  it("missing true/false next is error", () => {
    const issues = validateFlowForActivation(
      { name: "x", trigger_type: "manual", trigger_config: {}, entry_node_id: "c" },
      [
        { node_key: "c", node_type: "condition", config: { subject: "var", subject_key: "v", operator: "present", true_next: "", false_next: "" } },
        { node_key: "a", node_type: "end", config: {} },
        { node_key: "b", node_type: "end", config: {} },
      ],
    )
    expect(issues.filter((i) => i.field === "true_next").length).toBe(1)
    expect(issues.filter((i) => i.field === "false_next").length).toBe(1)
  })
  it("valid YES/NO passes", () => {
    const issues = validateFlowForActivation(
      { name: "x", trigger_type: "manual", trigger_config: {}, entry_node_id: "c" },
      [
        { node_key: "c", node_type: "condition", config: { subject: "var", subject_key: "v", operator: "present", true_next: "a", false_next: "b" } },
        { node_key: "a", node_type: "end", config: {} },
        { node_key: "b", node_type: "end", config: {} },
      ],
    )
    expect(issues.filter((i) => i.severity === "error")).toEqual([])
  })
})

describe("Flow condition — canvas edges binary", () => {
  it("true/false labelled edges", () => {
    const nodes: BuilderNode[] = [
      { node_key: "c", node_type: "condition", config: { subject: "var", subject_key: "v", operator: "equals", value: "x", true_next: "a", false_next: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "end", config: {} },
    ]
    const edges = deriveCanvasEdges(nodes)
    expect(edges.map((e) => e.sourceHandle).sort()).toEqual(["false", "true"])
    expect(edges.every((e) => e.label === "true" || e.label === "false")).toBe(true)
  })
})

describe("Automation condition — branch model still binary YES/NO", () => {
  it("unified taxonomy keeps condition under Logic", async () => {
    const { UNIFIED_PRIMITIVES } = await import("@/lib/automations/unified-taxonomy")
    const c = UNIFIED_PRIMITIVES.find((p) => p.id === "condition")!
    expect(c.category).toBe("logic")
    expect(c.hosts).toEqual(expect.arrayContaining(["flow", "automation"]))
  })
})
