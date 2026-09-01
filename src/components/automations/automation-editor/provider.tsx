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
  const setState = useCallback<typeof setStateRaw>((updater) => {
    setDirty(true);
    setStateRaw(updater as never);
  }, []);

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
    // Adapt steps → nodes for existing validator (keeps one validator)
    const nodes = stepsToNodes(deferred.steps);
    // Empty Starting Step is represented as no trigger config → validator will flag entry
    return validateFlowForActivation(
      { name: deferred.name, trigger_type: "keyword" as never, trigger_config: deferred.trigger_config, entry_node_id: nodes[0]?.node_key ?? null },
      nodes as never
    );
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
    if (next === "active" && !canPublish) { toast.error("Fix validation errors before publishing"); return; }
    if (next === "active") await save();
    // For now status maps to is_active; archived via separate delete/folder later
    const is_active = next === "active";
    setStateRaw((s) => ({ ...s, is_active }));
    setDirty(true);
    // Persist via save after
    toast.success(next === "active" ? "Published" : next === "paused" ? "Paused" : "Draft");
  }, [canPublish, save]);

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
  }), [initial.id, state, setState, dirty, saving, effectiveView, setView, derivedNodes, issues, canPublish, save, setStatus, deleteAutomation, flashKey, requestFlash]);

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
