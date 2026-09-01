"use client";

import { GitFork, List } from "lucide-react";
import { FlowCanvas } from "@/components/flows/flow-canvas";
import { AutomationEditorProvider, useAutomationEditor } from "./provider";
import { AutomationEditorHeader } from "./header";
import { AutomationBasicView } from "./basic-view";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { BuilderInitial } from "@/components/automations/automation-builder";
import { FlowEditorProvider } from "@/components/flows/flow-editor-state";
import { DEFAULT_FALLBACK_POLICY, type FlowRow, type FlowNodeRow } from "@/lib/flows/types";

// Inner shell content — toggle + stage (no persistent validation)
function ShellChrome() {
  const { view, setView } = useAutomationEditor();
  const t = useTranslations("Flows.builder");

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f8f9fb]">
      <AutomationEditorHeader />
      {/* View switch — Manychat: pill top-right Go To Basic/Flow Builder, not segmented middle */}
      <div className="flex justify-end px-4 py-2">
        <div role="group" aria-label="Editor view" className="inline-flex gap-0.5 rounded-full border border-border bg-white p-0.5 shadow-sm">
          <SegButton active={view === "flow"} onClick={() => setView("flow")} icon={<GitFork className="h-3.5 w-3.5" />} label="Flow" />
          <SegButton active={view === "basic"} onClick={() => setView("basic")} icon={<List className="h-3.5 w-3.5" />} label="Basic" />
        </div>
      </div>
      {/* Workspace — no artificial card, occupies available area; no persistent validation */}
      <div className="min-h-0 flex-1 overflow-hidden bg-[#f8f9fb]">
        {view === "flow" ? (
          <FlowCanvasBridge />
        ) : (
          <div className="h-full overflow-y-auto bg-[#f8f9fb]">
            <AutomationBasicView />
          </div>
        )}
      </div>
    </div>
  );
}

// Bridge: adapt automation state to FlowEditorProvider expected by FlowCanvas/FlowBuilder
function FlowCanvasBridge() {
  const { state, setState, derivedNodes } = useAutomationEditor();
  // Reuse FlowCanvas by wrapping in FlowEditorProvider with synthetic flow
  const syntheticFlow: FlowRow = {
    id: "automation-bridge",
    account_id: "",
    user_id: "",
    name: state.name,
    description: state.description,
    trigger_type: "keyword" as FlowRow["trigger_type"],
    trigger_config: state.trigger_config,
    entry_node_id: derivedNodes[0]?.node_key ?? null,
    status: state.is_active ? "active" : "draft",
    fallback_policy: DEFAULT_FALLBACK_POLICY,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    execution_count: 0,
    last_executed_at: null,
  };
  const syntheticNodes: FlowNodeRow[] = derivedNodes.map((n) => ({
    id: n.node_key,
    flow_id: syntheticFlow.id,
    node_key: n.node_key,
    node_type: n.node_type,
    config: n.config,
    position_x: n.position_x ?? 0,
    position_y: n.position_y ?? 0,
    created_at: new Date().toISOString(),
  }));
  // We don't actually edit via FlowEditorProvider here — we just render canvas
  // with derived nodes. For Phase 1, Basic edits flow through automation state,
  // Flow edits are read-only preview. Full two-way sync is Stage 3.
  return (
    <FlowEditorProvider initialFlow={syntheticFlow} initialNodes={syntheticNodes}>
      <FlowCanvas />
    </FlowEditorProvider>
  );
}

export function AutomationEditorShell({ initial }: { initial: BuilderInitial }) {
  return (
    <AutomationEditorProvider initial={initial}>
      <ShellChrome />
    </AutomationEditorProvider>
  );
}

function SegButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {icon}{label}
    </button>
  );
}
