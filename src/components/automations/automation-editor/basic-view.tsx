"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, GripVertical, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useAutomationEditor } from "./provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { BuilderStep } from "@/components/automations/automation-builder";
import { stepsToNodes } from "@/lib/automations/automation-editor-adapter";
import type { BuilderNode } from "@/components/flows/shared";

const NodeConfigForm = dynamic(() => import("@/components/flows/forms/node-config-form").then((m) => m.NodeConfigForm), { ssr: false });

const TRIGGER_OPTIONS = [
  { value: "keyword_match", label: "Keyword" },
  { value: "first_inbound_message", label: "First inbound" },
  { value: "manual", label: "Manual" },
  { value: "new_message_received", label: "New message" },
  { value: "tag_added", label: "Tag added" },
];

export function AutomationBasicView() {
  const { state, setState, requestFlash, flashKey } = useAutomationEditor();
  const t = useTranslations("Automations.builder");
  const [expanded, setExpanded] = useState<string | null>(null);

  const hasTrigger = !!state.trigger_type && state.trigger_type.trim() !== "" && Object.keys(state.trigger_config ?? {}).length > 0;
  // Consider keyword_match with empty keywords as no trigger (Starting Step blank)
  const isBlankTrigger = state.trigger_type === "keyword_match" && Array.isArray((state.trigger_config as { keywords?: string[] })?.keywords) && (state.trigger_config as { keywords?: string[] }).keywords!.length === 0;

  const selectedStep = expanded ? state.steps.find((s) => s.cid === expanded) ?? null : null;
  const selectedIdx = expanded ? state.steps.findIndex((s) => s.cid === expanded) : -1;
  const allNodesForSelected = selectedStep ? stepsToNodes(state.steps) : [];
  const selectedNode: BuilderNode | null = selectedStep && selectedIdx >= 0 ? { node_key: selectedStep.cid, node_type: (allNodesForSelected[selectedIdx]?.node_type ?? "send_message") as BuilderNode["node_type"], config: selectedStep.step_config, position_x: 0, position_y: 0 } : null;

  return (
    <div className="flex h-full min-h-0">
      {/* Left — step list (Manychat: 280px, Starting Step + Create New Step) */}
      <div className="w-[300px] shrink-0 border-r border-[#e5e7eb] bg-white p-3">
        <p className="px-2 py-2 text-xs font-medium text-muted-foreground">Starting Step</p>
        <div className="space-y-2">
          {!hasTrigger || isBlankTrigger ? (
            <button onClick={() => setState((s) => ({ ...s, trigger_type: "keyword_match" as never, trigger_config: { keywords: ["hello"], match_type: "contains" } }))} className="flex w-full items-center justify-center rounded-lg border border-dashed border-[#1a73e8]/40 bg-[#f8f9fb] px-3 py-3 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
              + New Trigger
            </button>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-800">{state.trigger_type}</p>
              <p className="truncate text-xs text-emerald-600">{JSON.stringify(state.trigger_config).slice(0,40)}</p>
              <button onClick={() => setState((s) => ({ ...s, trigger_type: "" as never, trigger_config: {} }))} className="mt-1 text-xs text-emerald-700 hover:underline">Change</button>
            </div>
          )}
          {state.steps.map((step, idx) => (
            <button key={step.cid} onClick={() => setExpanded(step.cid)} className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left", expanded === step.cid ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]" : "border-[#e5e7eb] bg-white hover:bg-gray-50", flashKey === step.cid && "ring-2 ring-amber-400")}>
              <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-medium">{idx + 1}</span>
              <span className="truncate text-sm font-medium">{step.step_type}</span>
            </button>
          ))}
          <button onClick={() => setExpanded(null)} className="flex w-full items-center justify-center rounded-lg border border-dashed border-[#e5e7eb] bg-white px-3 py-2.5 text-sm text-muted-foreground hover:bg-gray-50">
            + Create New Step
          </button>
        </div>
      </div>

      {/* Middle — selected step config (Manychat: content blocks) */}
      <div className="flex-1 overflow-y-auto bg-[#f8f9fb] p-6">
        {selectedStep && selectedNode ? (
          <div className="mx-auto max-w-[560px] rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
            <div className="border-b border-[#e5e7eb] bg-[#e8f0fe] px-4 py-3">
              <h3 className="text-sm font-semibold text-[#1a73e8]">{selectedStep.step_type}</h3>
            </div>
            <div className="p-4">
              <NodeConfigForm node={selectedNode} allNodes={allNodesForSelected} showAdvanced={false} onUpdateConfig={(patch) => setState((s) => ({ ...s, steps: s.steps.map((x, i) => i===selectedIdx ? { ...x, step_config: { ...x.step_config, ...patch } } : x) }))} />
              <div className="mt-4 flex items-center justify-between border-t border-[#e5e7eb] pt-3">
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={selectedIdx===0} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[selectedIdx]; a[selectedIdx]=a[selectedIdx-1]; a[selectedIdx-1]=t; setExpanded(a[selectedIdx-1].cid); return {...s, steps: a}; })}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={selectedIdx===state.steps.length-1} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[selectedIdx]; a[selectedIdx]=a[selectedIdx+1]; a[selectedIdx+1]=t; setExpanded(a[selectedIdx+1].cid); return {...s, steps: a}; })}><ArrowDown className="h-4 w-4" /></Button>
                </div>
                <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => { setState((s) => ({ ...s, steps: s.steps.filter((_, i) => i!==selectedIdx) })); setExpanded(null); }}><Trash2 className="mr-1 h-4 w-4" /> Delete</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[560px] rounded-xl border border-dashed border-[#e5e7eb] bg-white p-12 text-center">
            <p className="text-sm font-medium text-foreground">Select a step to edit</p>
            <p className="mt-1 text-xs text-muted-foreground">Tap a step on the left or create a new one</p>
          </div>
        )}
        {!selectedStep && (
          <div className="mx-auto mt-6 max-w-[560px] flex flex-wrap justify-center gap-2">
            {["send_message","send_buttons","condition","wait"].map((tp) => (
              <button key={tp} onClick={() => { const cid=`c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; setState((s) => ({ ...s, steps: [...s.steps, { cid, step_type: tp as BuilderStep["step_type"], step_config: tp==="send_message" ? {text:""} : tp==="condition" ? {subject:"tag_presence", operand:"", value:""} : tp==="wait" ? {amount:1, unit:"hours"} : {}}] })); setExpanded(cid); }} className="rounded-full border border-[#e5e7eb] bg-white px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-gray-50">
                <Plus className="mr-1 inline h-3 w-3" /> {tp.replace("_"," ")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right — phone preview (Manychat: white phone) */}
      <div className="hidden w-[360px] shrink-0 border-l border-[#e5e7eb] bg-[#f8f9fb] p-6 lg:block">
        <div className="mx-auto w-[280px] rounded-[32px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>9:41</span><span>● ● ●</span>
          </div>
          <div className="min-h-[320px] rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground">
            Preview — messages appear here
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">Add content blocks to see preview</p>
      </div>
    </div>
  );
}
