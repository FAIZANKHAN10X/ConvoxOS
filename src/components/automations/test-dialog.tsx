"use client"
import { useEffect, useState } from "react"
import { Search, FlaskConical } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { previewAutomationSteps, previewFlowNodes } from "@/lib/automations/dry-run"
import type { BuilderStep } from "@/components/automations/automation-builder"
import type { BuilderNode } from "@/components/flows/shared"

interface Props {
  open: boolean
  onClose: () => void
  automationSteps?: BuilderStep[]
  flowNodes?: BuilderNode[]
  triggerLabel?: string
}

export function TestDialog({ open, onClose, automationSteps, flowNodes, triggerLabel }: Props) {
  const [query, setQuery] = useState("")
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string | null }[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!open || query.trim().length < 2) return
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const { data } = await supabase.from("contacts").select("id,name,phone").ilike("name", `%${query}%`).limit(8)
      if (!cancelled) setContacts((data ?? []) as unknown as typeof contacts)
    })()
    return () => { cancelled = true }
  }, [query, open])

  const preview = automationSteps ? previewAutomationSteps(automationSteps) : flowNodes ? previewFlowNodes(flowNodes) : []

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Test Automation</DialogTitle>
          <DialogDescription>Dry-run preview — no messages, webhooks or external side effects are sent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Contact (optional, for context)</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts by name…" className="bg-muted pl-8" />
            </div>
            {contacts.length > 0 && (
              <div className="mt-2 max-h-32 overflow-auto rounded border border-border bg-muted">
                {contacts.map((c) => (
                  <button key={c.id} onClick={() => { setSelected(c.id); setQuery(c.name ?? c.phone ?? c.id) }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-card">
                    {c.name ?? "Unnamed"} <span className="text-muted-foreground">{c.phone ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && <p className="mt-1 text-[11px] text-muted-foreground">Selected: {selected} — preview does not send to this contact.</p>}
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Trigger</p>
            <p className="text-sm text-foreground">{triggerLabel ?? "This automation's trigger"}</p>
            <div className="mt-3 space-y-1.5">
              {preview.length === 0 ? <p className="text-xs text-muted-foreground">No steps yet.</p> : preview.map((p, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium text-foreground">{p.label}</span>
                  {p.detail && <span className="text-muted-foreground">— {p.detail}</span>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-amber-300/80">Dry-run only. Real messages are not sent.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
