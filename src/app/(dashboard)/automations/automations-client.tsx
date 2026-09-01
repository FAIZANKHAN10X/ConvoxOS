"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
  Search,
  Workflow,
  Archive,
  HelpCircle,
  UserPlus,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import { useTranslations } from "next-intl"
import type { Automation } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { triggerMeta, formatRelative } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"

const TEMPLATE_ORDER: TemplateSlug[] = [
  "welcome_message",
  "out_of_office",
  "lead_qualifier",
  "follow_up_reminder",
]

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
}

type FlowRow = {
  id: string
  name: string
  description: string | null
  status: "draft" | "active" | "archived"
  trigger_type: string
  trigger_config: Record<string, unknown>
  execution_count: number
  last_executed_at: string | null
  created_at: string
  updated_at: string
}

type UnifiedRow =
  | {
      kind: "automation"
      id: string
      name: string
      description: string | null
      status: "active" | "draft"
      trigger_type: string
      trigger_config: Record<string, unknown>
      execution_count: number
      last_executed_at: string | null
      created_at: string
      channel?: string | null
    }
  | {
      kind: "flow"
      id: string
      name: string
      description: string | null
      status: "draft" | "active" | "archived"
      trigger_type: string
      trigger_config: Record<string, unknown>
      execution_count: number
      last_executed_at: string | null
      created_at: string
      channel?: string | null
    }

type FlowTemplateSummary = {
  slug: string
  name: string
  description: string
  icon: "MessageSquare" | "HelpCircle" | "UserPlus"
  node_count: number
}

const FLOW_ICON: Record<string, typeof Workflow> = {
  MessageSquare: MessageCircle,
  HelpCircle,
  UserPlus,
}

function flowTriggerLabel(t: string): string {
  if (t === "keyword") return "Keyword Match"
  if (t === "first_inbound_message") return "First Message"
  if (t === "manual") return "Manual"
  return t
}

interface AutomationsClientProps {
  initialAutomations?: Automation[] | null
  initialFlows?: FlowRow[] | null
  initialTemplates?: FlowTemplateSummary[]
}

export function AutomationsClient({ initialAutomations, initialFlows, initialTemplates }: AutomationsClientProps) {
  const router = useRouter()
  const canCreate = useCan("send-messages")
  const t = useTranslations("Automations.list")
  const [automations, setAutomations] = useState<Automation[] | null>(initialAutomations ?? null)
  const [flows, setFlows] = useState<FlowRow[] | null>(initialFlows ?? null)
  const [flowTemplates, setFlowTemplates] = useState<FlowTemplateSummary[]>(initialTemplates ?? [])
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<UnifiedRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft" | "archived">("all")
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"my" | "basic">("my")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const [aRes, fRes] = await Promise.all([
        supabase.from("automations").select("*").order("created_at", { ascending: false }),
        supabase.from("flows").select("*").order("created_at", { ascending: false }),
      ])
      if (aRes.error) throw aRes.error
      if (fRes.error) throw fRes.error
      setAutomations((aRes.data ?? []) as Automation[])
      setFlows((fRes.data ?? []) as FlowRow[])
      // Flow templates (optional, ignore errors)
      try {
        const tr = await fetch("/api/flows/templates", { cache: "no-store" })
        if (tr.ok) {
          const j = (await tr.json()) as { templates: FlowTemplateSummary[] }
          setFlowTemplates(j.templates ?? [])
        }
      } catch {
        // ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations")
    }
  }

  const hydratedRef = useRef(!!(initialAutomations && initialFlows))
  useEffect(() => {
    if (hydratedRef.current) { hydratedRef.current = false; return }
    load()
  }, [])

  const unified: UnifiedRow[] = useMemo(() => {
    const rows: UnifiedRow[] = []
    if (automations) {
      for (const a of automations) {
        const cfg = (a.trigger_config ?? {}) as Record<string, unknown>
        rows.push({
          kind: "automation",
          id: a.id,
          name: a.name,
          description: (a as unknown as { description?: string | null }).description ?? null,
          status: a.is_active ? "active" : "draft",
          trigger_type: a.trigger_type,
          trigger_config: cfg,
          execution_count: a.execution_count,
          last_executed_at: a.last_executed_at ?? null,
          created_at: a.created_at,
          channel: (cfg.channel as string) ?? null,
        })
      }
    }
    if (flows) {
      for (const f of flows) {
        const cfg = (f.trigger_config ?? {}) as Record<string, unknown>
        rows.push({
          kind: "flow",
          id: f.id,
          name: f.name,
          description: f.description,
          status: f.status,
          trigger_type: f.trigger_type,
          trigger_config: cfg,
          execution_count: f.execution_count,
          last_executed_at: f.last_executed_at,
          created_at: f.created_at,
          channel: (cfg.channel as string) ?? null,
        })
      }
    }
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return rows
  }, [automations, flows])

  const filtered = useMemo(() => {
    let out = unified
    if (statusFilter !== "all") {
      out = out.filter((r) => r.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          r.trigger_type.toLowerCase().includes(q),
      )
    }
    return out
  }, [unified, statusFilter, search])

  async function toggleActive(row: UnifiedRow, next: boolean) {
    if (row.kind === "automation") {
      // optimistic
      setAutomations((prev) => prev?.map((x) => (x.id === row.id ? { ...x, is_active: next } : x)) ?? prev)
      const res = await fetch(`/api/automations/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) {
        setAutomations((prev) => prev?.map((x) => (x.id === row.id ? { ...x, is_active: !next } : x)) ?? prev)
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.updateError"))
        return
      }
      toast.success(next ? t("toasts.activated") : t("toasts.paused"))
    } else {
      setFlows((prev) => prev?.map((x) => (x.id === row.id ? { ...x, status: next ? "active" : "draft" } : x)) ?? prev)
      const res = await fetch(`/api/flows/${row.id}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next ? "active" : "draft" }),
      })
      if (!res.ok) {
        setFlows((prev) => prev?.map((x) => (x.id === row.id ? { ...x, status: next ? "draft" : "active" } : x)) ?? prev)
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.updateError"))
        return
      }
      toast.success(next ? t("toasts.activated") : t("toasts.paused"))
    }
  }

  async function duplicate(row: UnifiedRow) {
    if (row.kind === "automation") {
      const res = await fetch(`/api/automations/${row.id}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.duplicateError"))
        return
      }
      toast.success(t("toasts.duplicated"))
      load()
    } else {
      const res = await fetch(`/api/flows/${row.id}/duplicate`, { method: "POST" }).catch(() => null)
      // Fallback: many flow duplicates via template_slug copy isn't exposed; try generic clone via API
      if (!res || !res.ok) {
        toast.error(t("toasts.duplicateError"))
        return
      }
      toast.success(t("toasts.duplicated"))
      load()
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const row = pendingDelete
    const url = row.kind === "automation" ? `/api/automations/${row.id}` : `/api/flows/${row.id}`
    const res = await fetch(url, { method: "DELETE" })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.deleteError"))
      return
    }
    toast.success(t("toasts.deleted"))
    setPendingDelete(null)
    load()
  }

  async function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`)
  }

  async function handleCreateBlank() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword_match",
          trigger_config: { keywords: [], match_type: "contains" },
          is_active: false,
          steps: [],
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Create failed: ${res.status}`)
      }
      const j = (await res.json()) as { automation: { id: string } }
      setCreateOpen(false)
      setNewName("")
      router.push(`/automations/${j.automation.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreating(false)
    }
  }

  async function handleUseFlowTemplate(slug: string) {
    // Canonical creation: flow templates are adapters to Automation, never create flows table rows.
    // Resolve flow template client-side, map to automation payload, then POST /api/automations.
    setCreating(true)
    try {
      // Dynamic import to avoid cycle; fall back to server fetch if needed
      const { getFlowTemplate } = await import("@/lib/flows/templates")
      const tpl = getFlowTemplate(slug)
      if (!tpl) throw new Error("Template not found")
      // Map trigger: keyword → keyword_match, first_inbound_message stays
      const triggerMap: Record<string, string> = { keyword: "keyword_match", first_inbound_message: "first_inbound_message", manual: "manual" }
      const trigger_type = (triggerMap[tpl.trigger_type] ?? tpl.trigger_type) as string
      // Map flow nodes → automation steps (closest taxonomy)
      const nodeToStep: Record<string, string> = {
        send_message: "send_message",
        send_buttons: "send_buttons",
        send_list: "send_list",
        send_media: "send_template",
        collect_input: "send_message",
        condition: "condition",
        set_tag: "add_tag",
        handoff: "assign_conversation",
        end: "close_conversation",
        wait: "wait",
        randomizer: "randomizer",
        start: "send_message",
      }
      const steps = tpl.nodes
        .filter((n) => n.node_type !== "start" && n.node_type !== "end")
        .map((n) => ({
          step_type: (nodeToStep[n.node_type] ?? "send_message") as string,
          step_config: n.config as Record<string, unknown>,
        }))
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          description: tpl.description,
          trigger_type,
          trigger_config: tpl.trigger_config,
          is_active: false,
          steps,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Create failed: ${res.status}`)
      }
      const j = (await res.json()) as { automation: { id: string } }
      setCreateOpen(false)
      router.push(`/automations/${j.automation.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreating(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    )
  }

  if (automations === null || flows === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="-m-6 flex min-h-[calc(100vh-4rem)]">
      {/* Left nav — My Automations / Basic / Sequences */}
      <div className="hidden w-56 shrink-0 border-r border-border bg-[#f8f9fb] p-4 sm:block">
        <nav className="space-y-1">
          <button onClick={() => setActiveTab("my")} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium", activeTab === "my" ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <span className="h-4 w-4 rounded bg-[#1a73e8]/20" /> My Automations
          </button>
          <button onClick={() => setActiveTab("basic")} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium", activeTab === "basic" ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <span className="h-4 w-4 rounded bg-muted" /> Basic
          </button>
          <Link href="/sequences" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <span className="h-4 w-4 rounded bg-muted" /> Sequences
          </Link>
        </nav>
      </div>

      {/* Main — light gray like Manychat, centered */}
      <div className="flex-1 bg-[#f8f9fb] p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-foreground">{activeTab === "basic" ? "Basic" : "My Automations"}</h1>
            {activeTab === "my" && (
              <GatedButton canAct={canCreate} gateReason="create automations" onClick={() => setCreateOpen(true)} className="bg-[#1a73e8] text-white hover:bg-[#1557b0] shadow-sm">
                <Plus className="h-4 w-4" />
                New Automation
              </GatedButton>
            )}
          </div>

          {activeTab === "basic" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">System automations that run automatically. Configure them once, they work for every contact.</p>
              <div className="grid gap-3">
                <div className="flex items-center gap-4 rounded-xl border border-border bg-white p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f0fe] text-[#1a73e8]">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Default Reply</p>
                    <p className="text-xs text-muted-foreground">Replies when no other automation matches</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toast.info("Default Reply — coming soon")}>Set Up</Button>
                </div>
                <div className="flex items-center gap-4 rounded-xl border border-border bg-white p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f0fe] text-[#1a73e8]">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Welcome Message</p>
                    <p className="text-xs text-muted-foreground">Greets new contacts on first interaction</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toast.info("Welcome Message — coming soon")}>Set Up</Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all Automations" className="w-64 bg-white pl-8 shadow-sm" />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden items-center gap-2 sm:flex">
                    {(["all", "active", "draft", "archived"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setStatusFilter(s)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", statusFilter === s ? "border-[#1a73e8] bg-[#1a73e8] text-white" : "border-border bg-white text-muted-foreground hover:bg-muted")}>
                        {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button type="button" onClick={() => setCreateOpen(true)} className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-dashed border-[#1a73e8]/40 bg-white px-4 py-2.5 text-sm font-medium text-[#1a73e8] hover:bg-[#1a73e8]/5">
                <Plus className="h-4 w-4" /> New Folder
              </button>
              <div className="flex justify-end">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" /> Trash
                </span>
              </div>

              {filtered.length === 0 ? (
        unified.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("emptyDesc")}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
            No automations with status &quot;{statusFilter}&quot;{search ? ` matching "${search}"` : ""}.
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {filtered.map((row) => (
            <UnifiedCard
              key={`${row.kind}:${row.id}`}
              row={row}
              onToggle={(next) => toggleActive(row, next)}
              onEdit={() => router.push(`/automations/${row.id}`)}
              onDuplicate={() => duplicate(row)}
              onLogs={() => router.push(`/automations/${row.id}/runs`)}
              onDelete={() => setPendingDelete(row)}
            />
          ))}
        </ul>
              )}
            </>
          )}

      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) { setCreateOpen(false); setNewName("") } }}>
        <DialogContent className="sm:max-w-3xl bg-popover text-popover-foreground">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle>New Automation</DialogTitle>
                <DialogDescription>Pick a template or start from scratch — both open the same editor.</DialogDescription>
              </div>
              <button type="button" onClick={handleCreateBlank} disabled={creating} className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50">Start From Scratch →</button>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Ready-to-go templates (initial state only)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TEMPLATE_ORDER.map((slug) => {
                const tpl = AUTOMATION_TEMPLATES[slug]
                const Icon = TEMPLATE_ICON[slug]
                return (
                  <button key={slug} type="button" onClick={() => startFromTemplate(slug)} disabled={creating} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="text-sm font-semibold text-popover-foreground">{tpl.name}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{tpl.description}</span>
                  </button>
                )
              })}
              {flowTemplates.map((tpl) => {
                const Icon = FLOW_ICON[tpl.icon] ?? FileText
                return (
                  <button key={`flow-${tpl.slug}`} type="button" onClick={() => handleUseFlowTemplate(tpl.slug)} disabled={creating} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="text-sm font-semibold text-popover-foreground">{tpl.name}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{tpl.description}</span>
                    <span className="mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">{tpl.node_count} nodes</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">Templates are starting state only — you choose Flow or Basic after opening.</p>
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">Create with AI — coming soon (describe your automation → generate). Reserved footer, not built.</div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Or name and create blank now</p>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Welcome menu" className="bg-muted" onKeyDown={(e) => { if (e.key === "Enter") handleCreateBlank() }} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreateBlank} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create automation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDesc", { name: pendingDelete?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  </div>
  )
}

function UnifiedCard({
  row,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
}: {
  row: UnifiedRow
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onLogs: () => void
  onDelete: () => void
}) {
  const isActive = row.status === "active"
  const meta = row.kind === "automation" ? triggerMeta(row.trigger_type) : null
  const label = row.kind === "automation" ? meta!.label : flowTriggerLabel(row.trigger_type)
  const pillClass = row.kind === "automation" ? meta!.pillClass : "border-border bg-muted text-muted-foreground"
  const Icon = row.kind === "automation" ? Zap : Workflow
  const channelBadge = row.channel && row.channel !== "any" ? row.channel : null

  return (
    <li className="rounded-xl border border-border bg-card transition-colors hover:border-border">
      <div className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10" aria-hidden>
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
            {isActive && (
              <span className="relative flex h-2 w-2" aria-label="active">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", isActive ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" : "border-border bg-muted text-muted-foreground")}>
              {isActive ? "Active" : row.status === "archived" ? "Archived" : "Draft"}
            </span>
          </div>
          {row.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", pillClass)}>{label}</span>
            {channelBadge && <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px]">{channelBadge}</span>}
            <span className="tabular-nums">{row.execution_count} runs</span>
            <span aria-hidden>·</span>
            <span>last {formatRelative(row.last_executed_at)}</span>
          </div>
        </button>
        <div className="flex items-center gap-3">
          {row.status !== "archived" && (
            <Switch checked={isActive} onCheckedChange={(v) => onToggle(!!v)} aria-label={isActive ? "Deactivate" : "Activate"} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Open menu" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4" />Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4" />Duplicate</DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}><FileText className="h-4 w-4" />{row.kind === "flow" ? "View Runs" : "View Logs"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}
