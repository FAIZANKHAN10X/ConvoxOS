"use client";

import { useState } from "react";
import { ChevronDown, GripVertical, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useAutomationEditor } from "./provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { BuilderStep } from "@/components/automations/automation-builder";

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
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      {/* Starting Step */}
      <div className="rounded-lg border border-dashed border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Starting Step</p>
        {!hasTrigger || isBlankTrigger ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-4 text-center">
            <p className="text-sm text-muted-foreground">No trigger yet</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {TRIGGER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setState((s) => ({ ...s, trigger_type: opt.value as never, trigger_config: opt.value === "keyword_match" ? { keywords: ["hello"], match_type: "contains" } : {} }))}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  + {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Pick how this automation starts — required before publishing</p>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-muted p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{state.trigger_type}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[320px]">{JSON.stringify(state.trigger_config)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setState((s) => ({ ...s, trigger_type: "" as never, trigger_config: {} }))}>Change</Button>
          </div>
        )}
      </div>

      {/* Steps linear */}
      <div className="space-y-3">
        {state.steps.map((step, idx) => (
          <div key={step.cid} className={cn("rounded-lg border bg-card", flashKey === step.cid && "ring-2 ring-amber-400 border-amber-400")}>
            <button type="button" onClick={() => setExpanded(expanded === step.cid ? null : step.cid)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{idx + 1}. {step.step_type}</span>
              <span className="ml-auto text-xs text-muted-foreground truncate max-w-[160px]">{JSON.stringify(step.step_config).slice(0,40)}</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded === step.cid && "rotate-180")} />
            </button>
            {expanded === step.cid && (
              <div className="border-t border-border p-4 space-y-3">
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Config: {JSON.stringify(step.step_config, null, 2).slice(0,400)}</div>
                <div className="flex justify-between">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" disabled={idx===0} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[idx]; a[idx]=a[idx-1]; a[idx-1]=t; return {...s, steps: a}; })}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" disabled={idx===state.steps.length-1} onClick={() => setState((s) => { const a=[...s.steps]; const t=a[idx]; a[idx]=a[idx+1]; a[idx+1]=t; return {...s, steps: a}; })}><ArrowDown className="h-4 w-4" /></Button>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setState((s) => ({ ...s, steps: s.steps.filter((_, i) => i!==idx) }))}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="flex justify-center">
          <div className="flex flex-wrap gap-2">
            {["send_message","send_buttons","condition","wait"].map((tp) => (
              <button key={tp} onClick={() => setState((s) => ({ ...s, steps: [...s.steps, { cid: `c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, step_type: tp as BuilderStep["step_type"], step_config: tp==="send_message" ? {text:""} : tp==="condition" ? {subject:"tag_presence", operand:"", value:""} : tp==="wait" ? {amount:1, unit:"hours"} : {}}] }))} className="rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="mr-1 inline h-3 w-3" /> {tp}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
