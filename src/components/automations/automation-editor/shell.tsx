"use client";

import { GitFork, List } from "lucide-react";
import { FlowCanvas } from "@/components/flows/flow-canvas";
import { AutomationEditorProvider, useAutomationEditor } from "./provider";
import { AutomationEditorHeader } from "./header";
import { AutomationBasicView } from "./basic-view";
import { NODE_META, nodeColors, type NodeType } from "@/components/flows/shared";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { BuilderInitial } from "@/components/automations/automation-builder";
import { FlowEditorProvider } from "@/components/flows/flow-editor-state";
import { DEFAULT_FALLBACK_POLICY, type FlowRow, type FlowNodeRow } from "@/lib/flows/types";

// Inner shell content — toggle + stage + validation
function ShellChrome() {
  const { view, setView, issues, requestFlash } = useAutomationEditor();
  const t = useTranslations("Flows.builder");
  const LEGEND_TYPES = Object.keys(NODE_META) as NodeType[];

  // We reuse Flow validation panel for now; issues are adapted via provider
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AutomationEditorHeader />
      <div className="flex items-center gap-4 px-6 py-3.5">
        <div role="group" aria-label="Editor view" className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          <SegButton active={view === "flow"} onClick={() => setView("flow")} icon={<GitFork className="h-3.5 w-3.5" />} label={t("canvasView")} />
          <SegButton active={view === "basic"} onClick={() => setView("basic")} icon={<List className="h-3.5 w-3.5" />} label={t("listView")} />
        </div>
        <div className="ml-auto hidden flex-wrap items-center gap-x-3.5 gap-y-1.5 lg:flex">
          {LEGEND_TYPES.map((tt) => (
            <span key={tt} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: nodeColors(tt).solid }} />
              {t(`nodes.${tt}.label`)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mx-6 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card-2">
        {view === "flow" ? (
          <FlowCanvasBridge />
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <AutomationBasicView />
          </div>
        )}
      </div>
      <div className="px-6 pb-5 pt-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Validation</p>
          <ul className="mt-2 space-y-1">
            {issues.length === 0 ? (
              <li className="text-xs text-muted-foreground">No issues — ready to publish</li>
            ) : (
              issues.map((iss, i) => (
                <li key={i} className={cn("text-xs", iss.severity === "error" ? "text-red-400" : "text-amber-400")}>
                  <button onClick={() => iss.node_key && requestFlash(iss.node_key)} className="text-left hover:underline">
                    {iss.severity === "error" ? "Error" : "Warning"}: {iss.message} {iss.node_key ? `(${iss.node_key})` : ""}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
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
