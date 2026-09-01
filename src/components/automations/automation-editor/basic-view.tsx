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

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Starting Step — Manychat: dashed placeholder, + New Trigger centered */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Starting Step</p>
          <p className="text-xs text-muted-foreground">What starts this automation</p>
        </div>
        <div className="p-4">
          {!hasTrigger || isBlankTrigger ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
              <p className="text-sm font-medium text-foreground">No trigger yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Pick how this automation starts — required before publishing</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {TRIGGER_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setState((s) => ({ ...s, trigger_type: opt.value as never, trigger_config: opt.value === "keyword_match" ? { keywords: ["hello"], match_type: "contains" } : {} }))} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{state.trigger_type}</p>
                <p className="truncate text-xs text-muted-foreground">{JSON.stringify(state.trigger_config)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setState((s) => ({ ...s, trigger_type: "" as never, trigger_config: {} }))}>Change</Button>
            </div>
          )}
        </div>
      </div>

      {/* Steps — clean linear, consistent spacing, no card soup */}
      <div className="space-y-3">
        {state.steps.map((step, idx) => {
          const allNodes = stepsToNodes(state.steps);
          const node: BuilderNode = { node_key: step.cid, node_type: (allNodes[idx]?.node_type ?? "send_message") as BuilderNode["node_type"], config: step.step_config, position_x: 0, position_y: 0 };
          return (
          <div key={step.cid} className={cn("rounded-xl border bg-card shadow-sm", flashKey === step.cid && "ring-2 ring-amber-400 border-amber-400")}>
            <button type="button" onClick={() => setExpanded(expanded === step.cid ? null : step.cid)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">{idx + 1}</span>
              <span className="text-sm font-medium text-foreground">{step.step_type}</span>
              <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block max-w-[200px]">{JSON.stringify(step.step_config).slice(0,60)}</span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded === step.cid && "rotate-180")} />
            </button>
            {expanded === step.cid && (
              <div className="border-t border-border p-4 space-y-4">
                <NodeConfigForm node={node} allNodes={allNodes} showAdvanced={false} onUpdateConfig={(patch) => setState((s) => ({ ...s, steps: s.steps.map((x, i) => i===idx ? { ...x, step_config: { ...x.step_config, ...patch } } : x) }))} />
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx===0} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[idx]; a[idx]=a[idx-1]; a[idx-1]=t; return {...s, steps: a}; })}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx===state.steps.length-1} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[idx]; a[idx]=a[idx+1]; a[idx+1]=t; return {...s, steps: a}; })}><ArrowDown className="h-4 w-4" /></Button>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-600" onClick={() => setState((s) => ({ ...s, steps: s.steps.filter((_, i) => i!==idx) }))}><Trash2 className="mr-1 h-4 w-4" /> Delete step</Button>
                </div>
              </div>
            )}
          </div>
        )})}

        <div className="flex justify-center pt-2">
          <div className="flex flex-wrap justify-center gap-2">
            {["send_message","send_buttons","condition","wait"].map((tp) => (
              <button key={tp} onClick={() => setState((s) => ({ ...s, steps: [...s.steps, { cid: `c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, step_type: tp as BuilderStep["step_type"], step_config: tp==="send_message" ? {text:""} : tp==="condition" ? {subject:"tag_presence", operand:"", value:""} : tp==="wait" ? {amount:1, unit:"hours"} : {}}] }))} className="rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="mr-1 inline h-3 w-3" /> {tp.replace("_"," ")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
