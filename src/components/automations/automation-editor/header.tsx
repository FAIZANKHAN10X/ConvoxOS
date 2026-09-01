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
    <header className="flex h-12 items-center gap-3 border-b border-[#e5e7eb] bg-white px-4">
      <div className="flex items-center gap-1 text-sm">
        <button type="button" onClick={() => router.push("/automations")} className="text-muted-foreground hover:text-foreground">Automations</button>
        <span className="text-muted-foreground">›</span>
        <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="Untitled" className="h-7 max-w-[200px] border-transparent bg-transparent px-1 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-border focus:bg-muted" />
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", state.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-600")}>{state.is_active ? "LIVE" : "DRAFT"}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          {dirty ? <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Edited</> : <><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Saved</>}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Undo" onClick={undo} disabled={!canUndo}><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Redo" onClick={redo} disabled={!canRedo}><Redo2 className="h-4 w-4" /></Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="hidden h-7 items-center gap-1 rounded border border-[#e5e7eb] bg-white px-2 text-xs font-medium text-[#1a73e8] hover:bg-gray-50 sm:inline-flex">
            <Eye className="h-3.5 w-3.5" /> Preview
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>In App</DropdownMenuItem>
            <DropdownMenuItem disabled>In Channel</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => setStatus("active")} disabled={!canPublish} className="h-7 bg-[#1a73e8] px-4 text-xs font-medium text-white hover:bg-[#1557b0] disabled:opacity-50">
          Set Live
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#e5e7eb] bg-white text-muted-foreground hover:bg-gray-50" aria-label="More">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={save} disabled={saving}>Save draft</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatus(state.is_active ? "draft" : "active")}>{state.is_active ? "Pause" : "Resume"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={deleteAutomation} className="text-red-600 focus:text-red-600">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
