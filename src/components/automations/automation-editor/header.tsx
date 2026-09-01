"use client";

import { ArrowLeft, MoreHorizontal, Eye, Undo2, Redo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAutomationEditor } from "./provider";
import { cn } from "@/lib/utils";

export function AutomationEditorHeader() {
  const router = useRouter();
  const { state, setState, dirty, saving, canPublish, save, setStatus, deleteAutomation, undo, redo, canUndo, canRedo } = useAutomationEditor();
  const statusLabel = state.is_active ? "Active" : "Draft";
  const setLiveLabel = state.is_active ? "Update" : "Set Live";

  return (
    <header className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
      <button type="button" onClick={() => router.push("/automations")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to Automations">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="Untitled automation" className="h-8 max-w-[280px] border-transparent bg-transparent px-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-border focus:bg-muted sm:text-base" />
      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", state.is_active ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" : "border-border bg-muted text-muted-foreground")}>{statusLabel}</span>
      {dirty && <span className="hidden items-center gap-1 text-xs text-amber-400 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Edited</span>}
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Undo" onClick={undo} disabled={!canUndo}><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Redo" onClick={redo} disabled={!canRedo}><Redo2 className="h-4 w-4" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted">
            <Eye className="h-3.5 w-3.5" /> Preview
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>In App (soon)</DropdownMenuItem>
            <DropdownMenuItem disabled>In Channel (soon)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted" aria-label="More">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={deleteAutomation}>Delete</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setStatus(state.is_active ? "draft" : "active")}>{state.is_active ? "Pause" : "Activate"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={save} disabled={saving} className="hidden sm:inline-flex">Save draft</Button>
        <Button size="sm" onClick={() => setStatus("active")} disabled={!canPublish} className={cn("bg-primary text-primary-foreground hover:bg-primary/90", !canPublish && "opacity-50")}>
          {dirty && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />} {setLiveLabel}
        </Button>
      </div>
    </header>
  );
}
