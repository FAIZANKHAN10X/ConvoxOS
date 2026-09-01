"use client";

import { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { AutomationTriggerType } from "@/types";
import type { BuilderStep, BuilderInitial } from "@/components/automations/automation-builder";
import { stepsToNodes, nodesToSteps } from "@/lib/automations/automation-editor-adapter";
import type { BuilderNode } from "@/components/flows/shared";
import { validateFlowForActivation, type ValidationIssue } from "@/lib/flows/validate";
import { validateStepsForActivation } from "@/lib/automations/validate";

export type AutomationStatus = "draft" | "active" | "paused" | "archived";
export type EditorView = "flow" | "basic";

export interface AutomationEditorState {
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  steps: BuilderStep[];
}

export interface AutomationEditorContextValue {
  automationId: string | null;
  state: AutomationEditorState;
  setState: (updaterOrValue: AutomationEditorState | ((prev: AutomationEditorState) => AutomationEditorState)) => void;
  dirty: boolean;
  saving: boolean;
  view: EditorView;
  setView: (v: EditorView) => void;
  derivedNodes: BuilderNode[];
  issues: ValidationIssue[];
  canPublish: boolean;
  save: () => Promise<void>;
  setStatus: (next: AutomationStatus) => Promise<void>;
  deleteAutomation: () => Promise<void>;
  flashKey: string | null;
  requestFlash: (key: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const Ctx = createContext<AutomationEditorContextValue | null>(null);
export function useAutomationEditor(): AutomationEditorContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAutomationEditor must be inside AutomationEditorProvider");
  return v;
}

const STORAGE_KEY = "wacrm.automationEditor.view";

export function AutomationEditorProvider({ initial, children }: { initial: BuilderInitial; children: ReactNode }) {
  const router = useRouter();
  const t = useTranslations("Flows.editorState");

  const [state, setStateRaw] = useState<AutomationEditorState>(() => ({
    name: initial.name,
    description: initial.description ?? "",
    trigger_type: initial.trigger_type,
    trigger_config: initial.trigger_config,
    is_active: initial.is_active,
    steps: initial.steps,
  }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const historyRef = useRef<AutomationEditorState[]>([initial as unknown as AutomationEditorState]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const setState = useCallback<typeof setStateRaw>((updater) => {
    setDirty(true);
    setStateRaw((prev) => {
      const next = typeof updater === "function" ? (updater as (p: AutomationEditorState) => AutomationEditorState)(prev) : (updater as AutomationEditorState);
      const hist = historyRef.current.slice(0, historyIndex + 1);
      hist.push(next);
      if (hist.length > 50) hist.shift();
      historyRef.current = hist;
      setHistoryIndex(hist.length - 1);
      return next;
    });
  }, [historyIndex]);
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIdx = historyIndex - 1;
    const prev = historyRef.current[nextIdx];
    setStateRaw(prev);
    setHistoryIndex(nextIdx);
    setDirty(JSON.stringify(prev) !== JSON.stringify(historyRef.current[0]));
  }, [historyIndex]);
  const redo = useCallback(() => {
    if (historyIndex >= historyRef.current.length - 1) return;
    const nextIdx = historyIndex + 1;
    const next = historyRef.current[nextIdx];
    setStateRaw(next);
    setHistoryIndex(nextIdx);
    setDirty(JSON.stringify(next) !== JSON.stringify(historyRef.current[0]));
  }, [historyIndex]);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  const [view, setViewRaw] = useState<EditorView>(() => {
    try {
      const s = window.localStorage.getItem(STORAGE_KEY);
      if (s === "flow" || s === "basic") return s;
    } catch {}
    return "flow";
  });
  const setView = useCallback((v: EditorView) => {
    setViewRaw(v);
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch {}
  }, []);

  const isMobile = useMatchMedia("(max-width: 767px)");
  const effectiveView: EditorView = isMobile ? "basic" : view;

  const derivedNodes = useMemo(() => stepsToNodes(state.steps), [state.steps]);

  // Flash signal shared across views (like FlowEditorProvider)
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashRef = useRef<number | null>(null);
  const requestFlash = useCallback((key: string) => {
    if (flashRef.current) window.clearTimeout(flashRef.current);
    setFlashKey(key);
    flashRef.current = window.setTimeout(() => { setFlashKey(null); flashRef.current = null; }, 1600) as unknown as number;
  }, []);
  useEffect(() => () => { if (flashRef.current) window.clearTimeout(flashRef.current); }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const deferred = useDeferredValue(state);
  const issues = useMemo<ValidationIssue[]>(() => {
    const triggerIssues: ValidationIssue[] = [];
    if (!deferred.trigger_type || (deferred.trigger_type as string).trim() === "") {
      triggerIssues.push({ severity: "error", scope: "trigger", field: "trigger_type", message: "Select a trigger for the Starting Step" });
    } else {
      // Use flow validator for trigger shape where applicable, fallback to steps
      try {
        const flowTrigger = validateFlowForActivation(
          { name: deferred.name, trigger_type: deferred.trigger_type as never, trigger_config: deferred.trigger_config, entry_node_id: deferred.steps[0]?.cid ?? null },
          stepsToNodes(deferred.steps) as never
        ).filter((i) => i.scope === "trigger");
        triggerIssues.push(...flowTrigger);
      } catch {}
    }
    // Steps validation via automation validator
    let stepIssues: ValidationIssue[] = [];
    try {
      const raw = validateStepsForActivation(deferred.steps as unknown as never[]);
      stepIssues = raw.map((r) => ({ severity: "error" as const, scope: "node" as const, message: r.message, field: r.path }));
    } catch {
      const nodes = stepsToNodes(deferred.steps);
      stepIssues = validateFlowForActivation(
        { name: deferred.name, trigger_type: deferred.trigger_type as never, trigger_config: deferred.trigger_config, entry_node_id: nodes[0]?.node_key ?? null },
        nodes as never
      ).filter((i) => i.scope !== "trigger");
    }
    return [...triggerIssues, ...stepIssues];
  }, [deferred]);

  const canPublish = useMemo(() => issues.every((i) => i.severity !== "error"), [issues]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: state.steps.map((s) => ({ step_type: s.step_type, step_config: s.step_config, branches: s.branches })),
      };
      const res = initial.id
        ? await fetch(`/api/automations/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch(`/api/automations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Save failed: ${res.status}`);
      setDirty(false);
      toast.success("Saved draft");
      if (!initial.id && body?.automation?.id) router.replace(`/automations/${body.automation.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }, [state, initial.id, router]);

  const setStatus = useCallback(async (next: AutomationStatus) => {
    if (next === "active" && !canPublish) {
      const first = issues.find((i) => i.severity === "error");
      toast.error(first ? first.message : "Fix validation errors before publishing", {
        description: first?.field ? `at ${first.field}` : undefined,
      });
      return;
    }
    if (next === "active") await save();
    // For now status maps to is_active; archived via separate delete/folder later
    const is_active = next === "active";
    setStateRaw((s) => ({ ...s, is_active }));
    setDirty(true);
    // Persist via save after
    toast.success(next === "active" ? "Published" : next === "paused" ? "Paused" : "Draft");
  }, [canPublish, save, issues]);

  const deleteAutomation = useCallback(async () => {
    if (!initial.id) return;
    if (!window.confirm(`Delete "${state.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/automations/${initial.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Delete failed"); return; }
    router.push("/automations");
  }, [initial.id, router, state.name]);

  const value = useMemo<AutomationEditorContextValue>(() => ({
    automationId: initial.id ?? null,
    state, setState, dirty, saving,
    view: effectiveView, setView,
    derivedNodes, issues, canPublish, save, setStatus, deleteAutomation, flashKey, requestFlash,
    undo, redo, canUndo, canRedo,
  }), [initial.id, state, setState, dirty, saving, effectiveView, setView, derivedNodes, issues, canPublish, save, setStatus, deleteAutomation, flashKey, requestFlash, undo, redo, canUndo, canRedo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useMatchMedia(query: string): boolean {
  const [m, setM] = useState<boolean>(() => typeof window !== "undefined" ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const h = (e: MediaQueryListEvent) => setM(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, [query]);
  return m;
}
