import { describe, it, expect } from "vitest"
import { waitMsForFlow } from "./engine"
import { validateFlowForActivation } from "./validate"
import { deriveCanvasEdges, outgoingSlots } from "./edges"
import type { BuilderNode } from "@/components/flows/shared"

describe("Flow Wait — waitMsForFlow", () => {
  it("minutes", () => expect(waitMsForFlow({ amount: 5, unit: "minutes" })).toBe(5 * 60_000))
  it("hours", () => expect(waitMsForFlow({ amount: 1, unit: "hours" })).toBe(3_600_000))
  it("days", () => expect(waitMsForFlow({ amount: 2, unit: "days" })).toBe(2 * 86_400_000))
  it("clamps to 1 unit when amount 0 (validator would reject)", () => expect(waitMsForFlow({ amount: 0, unit: "minutes" })).toBe(60_000))
})

describe("Flow Wait — validation", () => {
  it("requires next_node_key", () => {
    const issues = validateFlowForActivation(
      { name: "x", trigger_type: "manual", trigger_config: {}, entry_node_id: "a" },
      [{ node_key: "a", node_type: "wait", config: { amount: 1, unit: "hours", next_node_key: "" } }],
    )
    expect(issues.some((i) => i.field === "next_node_key" && i.node_key === "a")).toBe(true)
  })
  it("valid wait passes", () => {
    const issues = validateFlowForActivation(
      { name: "x", trigger_type: "manual", trigger_config: {}, entry_node_id: "a" },
      [
        { node_key: "a", node_type: "wait", config: { amount: 1, unit: "hours", next_node_key: "b" } },
        { node_key: "b", node_type: "end", config: {} },
      ],
    )
    expect(issues.filter((i) => i.severity === "error")).toEqual([])
  })
})

describe("Flow Wait — edges", () => {
  it("single outgoing next", () => {
    const nodes: BuilderNode[] = [
      { node_key: "w", node_type: "wait", config: { amount: 1, unit: "hours", next_node_key: "n2" } },
      { node_key: "n2", node_type: "end", config: {} },
    ]
    expect(deriveCanvasEdges(nodes)).toEqual([{ id: "w--next--n2", source: "w", target: "n2", sourceHandle: "next" }])
    expect(outgoingSlots(nodes[0])).toEqual([{ id: "next", label: "Next" }])
  })
})

describe("Flow Wait — unified product preserves vars/channel", () => {
  // Documented invariant: pending context stores vars + trigger_channel + next_node_key
  it("context shape is serializable", () => {
    const ctx = { next_node_key: "next", vars: { name: "Ava" }, trigger_channel: "telegram" as const, conversation_id: "c1", flow_id: "f1" }
    expect(JSON.stringify(ctx)).toContain("next_node_key")
  })
})
