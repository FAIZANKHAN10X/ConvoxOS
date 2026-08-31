"use client"

/* eslint-disable react-hooks/set-state-in-effect */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  FlaskConical,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
  ListPlus,
  CheckSquare,
  Shuffle,
  Flag,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from "@/components/interactive/interactive-builder"
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive"
import { createClient } from "@/lib/supabase/client"
import {
  childPath,
  insertAt,
  mapAtPath,
  moveAt,
  removeAt,
  type ParentScope,
  type StepPath,
} from "@/lib/automations/builder-tree"
import { TestDialog } from "./test-dialog"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "send_message", icon: MessageSquare, border: "border-l-primary" },
  send_buttons: { label: "send_buttons", icon: MousePointerClick, border: "border-l-primary" },
  send_list: { label: "send_list", icon: List, border: "border-l-primary" },
  send_template: { label: "send_template", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "add_tag", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "remove_tag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "assign_conversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "update_contact_field", icon: PencilLine, border: "border-l-primary" },
  create_deal: { label: "create_deal", icon: Briefcase, border: "border-l-primary" },
  create_task: { label: "create_task", icon: CheckSquare, border: "border-l-primary" },
  randomizer: { label: "randomizer", icon: Shuffle, border: "border-l-amber-500" },
  goal: { label: "goal", icon: Flag, border: "border-l-emerald-500" },
  enroll_in_sequence: { label: "enroll_in_sequence", icon: ListPlus, border: "border-l-violet-500" },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: { label: "condition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "send_webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "close_conversation", icon: CircleSlash, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "create_task",
  "randomizer",
  "goal",
  "enroll_in_sequence",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "customer_replied" },
  { value: "new_contact_created" },
  { value: "contact_changed" },
  { value: "note_added" },
  { value: "task_added" },
  { value: "conversation_assigned" },
  { value: "tag_added" },
  { value: "opportunity_created" },
  { value: "pipeline_stage_changed" },
  { value: "inbound_webhook" },
  { value: "time_based" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

// The send_buttons / send_list step_config IS an InteractiveMessagePayload,
// but step_config is typed generically as Record<string, unknown>. These two
// helpers hold the single unavoidable structural cast in one place so a
// payload-shape change has one seam to update instead of four scattered
// `as unknown as` sites.
function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>
}
function asInteractive(cfg: Record<string, unknown>): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_buttons":
      return toStepConfig(blankButtonsPayload())
    case "send_list":
      return toStepConfig(blankListPayload())
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "create_task":
      return { title: "", description: "", due_at: "", assigned_to: "" }
    case "randomizer":
      return { variants: [{ id: "a", label: "Variant A", weight: 50 }, { id: "b", label: "Variant B", weight: 50 }], mode: "random" }
    case "goal":
      return { condition: { subject: "tag_presence", operand: "", value: "" }, timeout_hours: 24 }
    case "enroll_in_sequence":
      return { sequence_id: "" }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("tags.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((t) => t.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("tags.select")}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t("tags.unknown", { id: value })}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("fields.name")}</option>
      <option value="email">{t("fields.email")}</option>
      <option value="company">{t("fields.company")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("fields.customFields")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{t("fields.unknown", { id: customValue })}</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("agents.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("agents.select")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("agents.unknown", { id: value })}</option>
      )}
    </select>
  )
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string
  stageId: string
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { pipelines, stages } = useResources()

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t("pipelines.pipelineIdLabel")}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("pipelines.stageIdLabel")}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)

  return (
    <>
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <select
          value={pipelineId}
          onChange={(e) => {
            const nextPipelineId = e.target.value
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            )
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t("pipelines.selectPipeline")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>{t("pipelines.unknownPipeline", { id: pipelineId })}</option>
          )}
        </select>
      </FieldBlock>
      <FieldBlock label={t("pipelines.stageLabel")}>
        <select
          value={stageId}
          onChange={(e) =>
            onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId ? t("pipelines.selectStage") : t("pipelines.selectPipelineFirst")}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>{t("pipelines.unknownStage", { id: stageId })}</option>
          )}
        </select>
      </FieldBlock>
    </>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
  t,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("templates.templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templates.languageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (t) => toValue(t.name, t.language ?? "en_US") === current,
  )

  return (
    <FieldBlock label={t("templates.templateLabel")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("templates.select")}</option>
        {templates.map((tmpl) => {
          const lang = tmpl.language ?? "en_US"
          return (
            <option key={tmpl.id} value={toValue(tmpl.name, lang)}>
              {tmpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t("templates.unknown", { name: templateName, lang: language || t("templates.unknownLang") })}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [stats, setStats] = useState<{ attempted: number; matched: number; unmatched: number; executed: number; completed: number; failed: number; cancelled: number; window: string } | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    let createdCid: string | null = null
    setState((s) => {
      const base = blankConfig(type)
      const isChannelStep = ["send_message", "send_buttons", "send_list", "send_template"].includes(type)
      if (isChannelStep) {
        const conversational = ["keyword_match", "new_message_received", "first_inbound_message", "interactive_reply"].includes(s.trigger_type)
        if (conversational && !(base as Record<string, unknown>).channel_target) {
          ;(base as Record<string, unknown>).channel_target = "current"
        }
      }
      const node: BuilderStep = {
        cid: cid(),
        step_type: type,
        step_config: base,
        branches: type === "condition" ? { yes: [], no: [] } : undefined,
      }
      createdCid = node.cid
      return { ...s, steps: insertAt(s.steps, parent, index, node) }
    })
    if (createdCid) setExpandedId(createdCid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitled")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("activeAria")}
          />
        </div>
        <Button variant="outline" onClick={() => setTestOpen(true)}>
          <FlaskConical className="h-4 w-4" /> Test
        </Button>
        <Button variant="outline" onClick={async () => {
          if (!initial.id) return
          setStatsOpen(true)
          const res = await fetch(`/api/automations/${initial.id}/stats`)
          const j = await res.json().catch(() => null)
          setStats(j)
        }}>
          Stats
        </Button>
        <Button variant="outline" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
        <TestDialog open={testOpen} onClose={() => setTestOpen(false)} automationSteps={state.steps} triggerLabel={state.trigger_type} />
        <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} automationId={initial.id} onRestore={() => window.location.reload()} />
        {statsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card border border-border rounded-lg p-4 w-full max-w-md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Stats (30d)</h3>
                <Button variant="ghost" size="sm" onClick={() => setStatsOpen(false)}>Close</Button>
              </div>
              {!stats ? <p className="text-sm text-muted-foreground">Loading…</p> : (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Attempted: <span className="font-mono">{stats.attempted}</span></div>
                  <div>Matched: <span className="font-mono">{stats.matched}</span></div>
                  <div>Unmatched: <span className="font-mono">{stats.unmatched}</span></div>
                  <div>Executed: <span className="font-mono">{stats.executed}</span></div>
                  <div>Completed: <span className="font-mono">{stats.completed}</span></div>
                  <div>Failed: <span className="font-mono">{stats.failed}</span></div>
                  <div>Cancelled: <span className="font-mono">{stats.cancelled}</span></div>
                  <div>Window: <span className="font-mono">{stats.window}</span></div>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Dry runs are not counted. Attempted = trigger evaluations in window.</p>
            </div>
          </div>
        )}
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={(tVal) => patchTop("trigger_type", tVal)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
              t={t}
            />
            <StepList
              steps={state.steps}
              basePath={[]}
              scope={{ kind: "root" }}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  t,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const [open, setOpen] = useState(false)
  const { stages } = useResources()
  const pipelineIdForStage = (config.pipeline_id as string) ?? ""
  const fromStageOptions = stages.filter((s) => !pipelineIdForStage || s.pipeline_id === pipelineIdForStage)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">{t("trigger")}</div>
            <div className="truncate text-sm font-medium text-foreground">
              {t(`triggers.${type}.label`)}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("triggerType")}
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`triggers.${o.value}.label`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(`triggers.${type}.hint`)}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === "interactive_reply" && (
              <InteractiveReplyConfig config={config} onChange={onConfigChange} t={t} />
            )}
            {(type === "keyword_match" || type === "interactive_reply") && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Channel</label>
                <select
                  value={(config.channel as string) ?? "any"}
                  onChange={(e) => onConfigChange({ ...config, channel: e.target.value })}
                  className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="any">Any</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                </select>
              </div>
            )}
            {type === "tag_added" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tag
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                  t={t}
                />
              </div>
            )}
            {type === "contact_changed" && (
              <>
                <FieldBlock label="Field">
                  <ContactFieldSelect
                    value={(config.field as string) ?? "name"}
                    onChange={(v) => onConfigChange({ ...config, field: v })}
                    t={t}
                  />
                </FieldBlock>
                <FieldBlock label="Value (optional — leave empty to fire on any change)">
                  <Input
                    value={(config.value as string) ?? ""}
                    onChange={(e) => onConfigChange({ ...config, value: e.target.value })}
                    placeholder="e.g. VIP"
                    className="bg-muted text-foreground"
                  />
                </FieldBlock>
              </>
            )}
            {type === "note_added" && (
              <p className="text-[11px] text-muted-foreground">
                Fires when a contact note is added. No additional configuration.
              </p>
            )}
            {type === "task_added" && (
              <p className="text-[11px] text-muted-foreground">
                Fires when a task is created. No additional configuration.
              </p>
            )}
            {type === "customer_replied" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Channel</label>
                <select
                  value={(config.channel as string) ?? "any"}
                  onChange={(e) => onConfigChange({ ...config, channel: e.target.value })}
                  className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="any">Any</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                </select>
              </div>
            )}
            {type === "opportunity_created" && (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">Optional filters — leave empty to fire for any opportunity.</p>
                <DealPipelineFields
                  pipelineId={(config.pipeline_id as string) ?? ""}
                  stageId={(config.stage_id as string) ?? ""}
                  onChange={(patch) => onConfigChange({ ...config, ...patch })}
                  t={t}
                />
              </div>
            )}
            {type === "pipeline_stage_changed" && (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">Optional filters — leave empty to fire for any stage change.</p>
                <DealPipelineFields
                  pipelineId={(config.pipeline_id as string) ?? ""}
                  stageId={(config.to_stage_id as string) ?? ""}
                  onChange={(patch) => onConfigChange({ ...config, pipeline_id: patch.pipeline_id, to_stage_id: patch.stage_id })}
                  t={t}
                />
                <FieldBlock label="From Stage (optional)">
                  <select
                    value={(config.from_stage_id as string) ?? ""}
                    onChange={(e) => onConfigChange({ ...config, from_stage_id: e.target.value })}
                    className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Any</option>
                    {fromStageOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </FieldBlock>
              </div>
            )}
            {type === "inbound_webhook" && (
              <FieldBlock label="Path (optional — leave empty to fire on any webhook)">
                <Input
                  value={(config.path as string) ?? ""}
                  onChange={(e) => onConfigChange({ ...config, path: e.target.value })}
                  placeholder="e.g. /lead or my-hook"
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            )}
            {type === "time_based" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("schedule")}
                </label>
                <Input
                  placeholder="Cron expression or HH:mm"
                  value={(config.schedule as string) ?? ""}
                  onChange={(e) =>
                    onConfigChange({ ...config, schedule: e.target.value })
                  }
                  className="bg-muted text-foreground"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("scheduleHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
  t,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(", "))

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("keywords")}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={t("keywordsHint")}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("config.matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) =>
            onChange({
              ...config,
              match_type: e.target.value as "exact" | "contains" | "word",
            })
          }
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("config.matchContains")}</option>
          <option value="word">{t("config.matchWord")}</option>
          <option value="exact">{t("config.matchExact")}</option>
        </select>
        {/* Only worth explaining for `word` — "contains" and "exact" read
            for themselves, and this is the one that changes which messages
            fire an automation in a way that isn't obvious. */}
        {config?.match_type === "word" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("config.matchWordHint")}
          </p>
        )}
      </div>
    </div>
  )
}

function InteractiveReplyConfig({
  config,
  onChange,
  t,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const ids = (config?.reply_ids as string[] | undefined) ?? []
  // Same local-draft-then-commit pattern as KeywordMatchConfig so
  // commas + spaces survive keystrokes.
  const [draft, setDraft] = useState(ids.join(", "))

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, reply_ids: parsed })
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("replyIds")}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t("replyIdsHint")}
        className="bg-muted font-mono text-foreground"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{t("replyIdsHelp")}</p>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

interface StepListProps {
  steps: BuilderStep[]
  /**
   * Path of the step that owns this list — `[]` for the root canvas,
   * the condition's own path for a branch column. Combined with
   * `scope` by `childPath` to address each child.
   */
  basePath: StepPath
  /** Which bucket this list reads and writes. */
  scope: ParentScope
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, basePath, scope, ...rest } = props

  return (
    <div className="flex w-full flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(scope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          basePath={basePath}
          scope={scope}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  scope,
  basePath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  scope: ParentScope
  basePath: StepPath
} & Omit<StepListProps, "steps" | "basePath" | "scope">) {
  const t = useTranslations("Automations.builder")
  const path = childPath(basePath, scope, index)
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  const nested = basePath.length > 0
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ fixed widths come back so the
  // flow visual stays recognisable — but only at the top level: a
  // branch column is a fraction of its condition's width, so a 320px
  // card inside one overflowed its own column and dragged the editor's
  // controls out of reach (issue #474). Nested cards fill the column
  // they were given instead.
  //
  // A condition is wider than a plain step because it has to hold two
  // branch columns side by side; 600px (the canvas is max-w-2xl, i.e.
  // 640px of content) leaves each branch ~294px — near enough to the
  // 320px a step gets at the top level for the same editors to fit.
  const width = nested
    ? "w-full"
    : isCondition
      ? "w-full max-w-[600px] sm:w-[600px]"
      : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div className={cn("z-10 flex min-w-0 flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isCondition ? "Condition" : step.step_type === "wait" ? "Wait" : "Action"}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(`steps.${meta.label}`)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-border px-4 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Move down"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("delete")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} path={path} {...props} />
        )}
      </div>

      {/* A condition branches into Yes/No (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!isCondition && (
        <AddButton onPick={(t) => props.addStepAt(scope, index + 1, t)} />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  path,
  ...props
}: {
  step: BuilderStep
  /** The condition's OWN path. Children hang off it, one marker each. */
  path: StepPath
} & Omit<StepListProps, "steps" | "basePath" | "scope">) {
  const t = useTranslations("Automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  return (
    // Stack Yes/No vertically until THIS CARD is wide enough for two
    // columns. A viewport breakpoint can't tell: a condition nested in
    // a branch is a fraction of the screen, and `sm:grid-cols-2` split
    // it anyway, leaving two columns too narrow to render a step in.
    <div className="@container mt-3 w-full">
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <BranchColumn label={t("branches.yes")} color="text-primary">
          <StepList
            {...props}
            steps={yes}
            basePath={path}
            scope={{ kind: "branch", parentCid: step.cid, branch: "yes" }}
          />
        </BranchColumn>
        <BranchColumn label={t("branches.no")} color="text-rose-400">
          <StepList
            {...props}
            steps={no}
            basePath={path}
            scope={{ kind: "branch", parentCid: step.cid, branch: "no" }}
          />
        </BranchColumn>
      </div>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  const t = useTranslations("Automations.builder")
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary"
          aria-label={t("addStep")}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover"
        >
          {ADDABLE_STEPS.map((tp) => {
            const Icon = STEP_META[tp].icon
            return (
              <DropdownMenuItem key={tp} onClick={() => onPick(tp)}>
                <Icon className="h-4 w-4" />
                {t(`steps.${STEP_META[tp].label}`)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-border" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("Automations.builder")
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <>
          <FieldBlock label="Channel">
            <select
              value={(cfg.channel_target as string) ?? ""}
              onChange={(e) => set({ channel_target: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="" disabled>
                Select channel…
              </option>
              <option value="current">Current Conversation</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("config.messageText")}>
            <Textarea
              value={(cfg.text as string) ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={t("config.placeholderMessageText")}
              className="min-h-24 bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "send_buttons":
    case "send_list":
      // The whole step_config IS the interactive payload; the shared
      // builder edits it in place (and enforces Meta's limits + preview).
      return (
        <>
          <FieldBlock label="Channel">
            <select
              value={(cfg.channel_target as string) ?? ""}
              onChange={(e) => set({ channel_target: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="" disabled>
                Select channel…
              </option>
              <option value="current">Current Conversation</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
            </select>
          </FieldBlock>
          <InteractiveBuilder
            value={asInteractive(cfg)}
            channel={(cfg.channel_target as string) === 'telegram' ? 'telegram' : 'whatsapp'}
            onChange={(payload) =>
              onChange({ ...step, step_config: toStepConfig(payload) })
            }
          />
        </>
      )
    case "send_template":
      return (
        <>
          <FieldBlock label="Channel">
            <select value="whatsapp" disabled className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground opacity-60">
              <option value="whatsapp">WhatsApp</option>
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">Templates are WhatsApp-only.</p>
          </FieldBlock>
          <SendTemplateFields
            templateName={(cfg.template_name as string) ?? ""}
            language={(cfg.language as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
        </>
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("config.tagLabel")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
            t={t}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("config.modeLabel")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("config.modes.round_robin")}</option>
              <option value="specific">{t("config.modes.specific")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("config.agentLabel")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
                t={t}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("config.fieldLabel")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
              t={t}
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t.raw("config.placeholderValue")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <FieldBlock label={t("config.titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_task":
      return (
        <>
          <FieldBlock label={t("config.titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Task title"
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea
              value={(cfg.description as string) ?? ""}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Optional details"
              className="min-h-20 bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Due Date (optional)">
            <Input
              type="datetime-local"
              value={(cfg.due_at as string) ?? ""}
              onChange={(e) => set({ due_at: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Assign to">
            <AgentSelect
              value={(cfg.assigned_to as string) ?? ""}
              onChange={(v) => set({ assigned_to: v })}
              t={t}
            />
          </FieldBlock>
        </>
      )
    case "randomizer": {
      const variants = (cfg.variants as Array<{ id: string; label: string; weight: number }> | undefined) ?? []
      const mode = (cfg.mode as string) ?? 'random'
      const updateVariant = (idx: number, patch: Partial<{ id: string; label: string; weight: number }>) =>
        set({ variants: variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)) })
      const addVariant = () =>
        set({ variants: [...variants, { id: `v${variants.length + 1}`, label: `Variant ${String.fromCharCode(65 + variants.length)}`, weight: 10 }] })
      const removeVariant = (idx: number) => set({ variants: variants.filter((_, i) => i !== idx) })
      const total = variants.reduce((s, v) => s + (v.weight ?? 0), 0)
      return (
        <div className="space-y-3">
          <FieldBlock label="Mode">
            <select
              value={mode}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="random">Random each time</option>
              <option value="sticky">Sticky (same contact always same branch)</option>
            </select>
          </FieldBlock>
          <div className="text-xs text-muted-foreground">Total weight: {total} (must sum to 100). {variants.length} variants.</div>
          <div className="space-y-2">
            {variants.map((v, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
                <Input
                  value={v.label}
                  onChange={(e) => updateVariant(idx, { label: e.target.value })}
                  placeholder="Label"
                  className="flex-1 bg-muted text-foreground"
                />
                <Input
                  type="number"
                  min={1}
                  value={v.weight}
                  onChange={(e) => updateVariant(idx, { weight: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-20 bg-muted text-foreground"
                />
                <span className="text-xs text-muted-foreground">%</span>
                {variants.length > 2 && (
                  <Button variant="ghost" size="sm" onClick={() => removeVariant(idx)} className="text-red-400 hover:bg-red-500/10"><Trash2 className="h-3 w-3" /></Button>
                )}
              </div>
            ))}
          </div>
          {variants.length < 6 && (
            <Button variant="ghost" size="sm" onClick={addVariant} className="mt-2"><Plus className="h-3 w-3" /> Add variant</Button>
          )}
          {Math.abs(total - 100) > 0.01 && <p className="text-xs text-amber-400">Weights must sum to 100 (currently {total}).</p>}
        </div>
      )
    }
    case "goal": {
      const cond = (cfg.condition as Record<string, unknown> | undefined) ?? { subject: 'tag_presence', operand: '' }
      const setCond = (patch: Record<string, unknown>) => set({ condition: { ...cond, ...patch } })
      return (
        <div className="space-y-3">
          <FieldBlock label="Goal Condition — when true, skip ahead">
            <select
              value={(cond.subject as string) ?? 'tag_presence'}
              onChange={(e) => setCond({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">Tag present</option>
              <option value="contact_field">Contact field equals</option>
              <option value="message_content">Message contains</option>
              <option value="time_of_day">Time of day</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Operand">
            <Input
              value={(cond.operand as string) ?? ''}
              onChange={(e) => setCond({ operand: e.target.value })}
              placeholder={cond.subject === 'contact_field' ? 'name' : cond.subject === 'tag_presence' ? 'tag id' : 'text or HH:mm-HH:mm'}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          {(cond.subject === 'contact_field' || cond.subject === 'message_content') && (
            <FieldBlock label="Value">
              <Input value={(cond.value as string) ?? ''} onChange={(e) => setCond({ value: e.target.value })} className="bg-muted text-foreground" />
            </FieldBlock>
          )}
          <FieldBlock label="Timeout (hours) — after this, continue without goal">
            <Input
              type="number"
              min={1}
              value={(cfg.timeout_hours as number) ?? 24}
              onChange={(e) => set({ timeout_hours: Math.max(1, Number(e.target.value) || 24) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <p className="text-[11px] text-muted-foreground">Goal waits (durable) until condition true or timeout. When satisfied, subsequent steps are skipped and execution continues after Goal.</p>
        </div>
      )
    }
    case "wait": {
      const hasUntil = typeof (cfg.until as string) === 'string' && (cfg.until as string).trim() !== ''
      const mode = hasUntil ? 'datetime' : 'duration'
      return (
        <div className="space-y-3">
          <FieldBlock label="Wait Type">
            <select
              value={mode}
              onChange={(e) => {
                if (e.target.value === 'datetime') set({ until: new Date(Date.now() + 3600000).toISOString().slice(0, 16), amount: undefined, unit: undefined } as unknown as Record<string, unknown>)
                else set({ until: undefined, amount: 1, unit: 'hours' } as unknown as Record<string, unknown>)
              }}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="duration">Duration</option>
              <option value="datetime">Until Date/Time</option>
            </select>
          </FieldBlock>
          {mode === 'duration' ? (
            <div className="grid grid-cols-2 gap-2">
              <FieldBlock label={t("config.amountLabel")}>
                <Input
                  type="number"
                  min={1}
                  value={(cfg.amount as number) ?? 1}
                  onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
              <FieldBlock label={t("config.unitLabel")}>
                <select
                  value={(cfg.unit as string) ?? "hours"}
                  onChange={(e) => set({ unit: e.target.value })}
                  className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="minutes">{t("config.units.minutes")}</option>
                  <option value="hours">{t("config.units.hours")}</option>
                  <option value="days">{t("config.units.days")}</option>
                </select>
              </FieldBlock>
            </div>
          ) : (
            <FieldBlock label="Until (local time)">
              <Input
                type="datetime-local"
                value={(cfg.until as string) ? String(cfg.until).slice(0, 16) : ''}
                onChange={(e) => set({ until: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                className="bg-muted text-foreground"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Automation will resume when this time is reached. Durable via pending execution table.</p>
            </FieldBlock>
          )}
        </div>
      )
    }
    case "condition": {
      const hasMulti = Array.isArray((cfg as unknown as { conditions?: unknown }).conditions) && ((cfg as unknown as { conditions: unknown[] }).conditions.length > 0)
      const conditions = hasMulti ? (cfg as unknown as { conditions: Array<{ subject: string; operand?: string; value?: string }> }).conditions : null
      const match = (cfg as unknown as { match?: string }).match ?? 'all'
      const setConditions = (next: Array<{ subject: string; operand?: string; value?: string }>) => set({ conditions: next, match })
      const setMatch = (m: string) => set({ match: m })
      const addCondition = () => {
        if (!hasMulti) {
          const first = { subject: (cfg.subject as string) ?? 'tag_presence', operand: (cfg.operand as string) ?? '', value: (cfg.value as string) ?? '' }
          set({ conditions: [first, { subject: 'tag_presence', operand: '', value: '' }], match: 'all', subject: undefined, operand: undefined, value: undefined } as unknown as Record<string, unknown>)
        } else {
          setConditions([...(conditions as Array<{ subject: string; operand?: string; value?: string }>), { subject: 'tag_presence', operand: '', value: '' }])
        }
      }
      const updateCondition = (idx: number, patch: Partial<{ subject: string; operand?: string; value?: string }>) => {
        if (!conditions) return
        setConditions(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
      }
      const removeCondition = (idx: number) => {
        if (!conditions) return
        const next = conditions.filter((_, i) => i !== idx)
        if (next.length <= 1) {
          // Collapse back to single when only one left
          const remaining = next[0]
          if (remaining) set({ subject: remaining.subject, operand: remaining.operand, value: remaining.value, conditions: undefined, match: undefined } as unknown as Record<string, unknown>)
          else set({ conditions: undefined, match: undefined } as unknown as Record<string, unknown>)
        } else setConditions(next)
      }
      if (hasMulti) {
        return (
          <>
            <FieldBlock label="Match">
              <select
                value={match}
                onChange={(e) => setMatch(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value="all">All (AND)</option>
                <option value="any">Any (OR)</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">If {match === 'all' ? 'every condition' : 'any condition'} matches, the Yes branch is taken; otherwise No.</p>
            </FieldBlock>
            <div className="space-y-3">
              {(conditions as Array<{ subject: string; operand?: string; value?: string }>).map((c, idx) => (
                <div key={idx} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Condition {idx + 1}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeCondition(idx)} className="h-6 text-red-400 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                  <FieldBlock label="Subject">
                    <select
                      value={c.subject ?? 'tag_presence'}
                      onChange={(e) => updateCondition(idx, { subject: e.target.value })}
                      className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="tag_presence">Tag present</option>
                      <option value="contact_field">Contact field</option>
                      <option value="message_content">Message contains</option>
                      <option value="time_of_day">Time of day</option>
                    </select>
                  </FieldBlock>
                  <FieldBlock label="Operand">
                    <Input
                      value={c.operand ?? ''}
                      onChange={(e) => updateCondition(idx, { operand: e.target.value })}
                      placeholder={c.subject === 'time_of_day' ? '09:00-17:00' : c.subject === 'contact_field' ? 'name' : 'tag id or text'}
                      className="bg-muted text-foreground"
                    />
                  </FieldBlock>
                  {(c.subject === 'contact_field' || c.subject === 'message_content') && (
                    <FieldBlock label="Value">
                      <Input value={c.value ?? ''} onChange={(e) => updateCondition(idx, { value: e.target.value })} className="bg-muted text-foreground" />
                    </FieldBlock>
                  )}
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={addCondition} className="mt-2"><Plus className="h-3.5 w-3.5" /> Add condition</Button>
          </>
        )
      }
      return (
        <>
          <FieldBlock label={t("config.subjectLabel")}>
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("config.subjects.tag_presence")}</option>
              <option value="contact_field">{t("config.subjects.contact_field")}</option>
              <option value="message_content">{t("config.subjects.message_content")}</option>
              <option value="time_of_day">{t("config.subjects.time_of_day")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("config.operandLabel")}>
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? t("config.placeholderTime")
                  : cfg.subject === "contact_field"
                  ? t("config.placeholderContact")
                  : cfg.subject === "tag_presence"
                  ? t("config.placeholderTag")
                  : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          {(cfg.subject === "contact_field" || cfg.subject === "message_content") && (
            <FieldBlock label="Value">
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
          <Button variant="ghost" size="sm" onClick={addCondition} className="mt-2"><Plus className="h-3.5 w-3.5" /> Add condition (AND/OR)</Button>
        </>
      )
    }
    case "send_webhook": {
      const headers = (cfg.headers as Record<string, string> | undefined) ?? {}
      const headersText = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')
      const setHeadersText = (text: string) => {
        const next: Record<string, string> = {}
        text.split('\n').forEach((line) => {
          const idx = line.indexOf(':')
          if (idx > 0) {
            const k = line.slice(0, idx).trim()
            const v = line.slice(idx + 1).trim()
            if (k) next[k] = v
          }
        })
        set({ headers: next })
      }
      return (
        <>
          <FieldBlock label="Method">
            <select
              value={(cfg.method as string) ?? 'POST'}
              onChange={(e) => set({ method: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("config.urlLabel")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://api.example.com/contacts/{{contact.id}}"
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Headers (one per line, Key: Value)">
            <Textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder="Authorization: Bearer xxx"
              className="min-h-16 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.bodyTemplateLabel")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              placeholder='{"contact_id":"{{contact.id}}"} — supports {{contact.*}}, {{vars.*}}, {{message.text}}'
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Store response?">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!cfg.store_response}
                onChange={(e) => set({ store_response: e.target.checked })}
                className="h-3.5 w-3.5 accent-primary"
              />
              Save response to variable
            </label>
          </FieldBlock>
          {cfg.store_response && (
            <FieldBlock label="Response variable name">
              <Input
                value={(cfg.response_var as string) ?? 'external_response'}
                onChange={(e) => set({ response_var: e.target.value })}
                placeholder="external_response"
                className="bg-muted font-mono text-xs text-foreground"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Available as {`{{vars.${(cfg.response_var as string) || 'external_response'}}}`} in later steps.</p>
            </FieldBlock>
          )}
        </>
      )
    }
    case "enroll_in_sequence": {
      const seqId = (cfg.sequence_id as string) ?? ""
      return (
        <FieldBlock label="Sequence">
          <Input
            value={seqId}
            onChange={(e) => set({ sequence_id: e.target.value })}
            placeholder="Sequence ID (UUID)"
            className="bg-muted font-mono text-xs text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Enrolls contact in sequence. Use sequence ID from Sequences list.</p>
        </FieldBlock>
      )
    }
    case "close_conversation":
      return (
        <p className="text-xs text-muted-foreground">
          {t("config.closeConversationHint", { defaultValue: "Sets the conversation status to \"closed\". No configuration needed." })}
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "no text yet"
    case "send_buttons":
    case "send_list":
      return interactivePayloadPreviewText(asInteractive(step.step_config)) || "no body yet"
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return (step.step_config.until as string) ? `until ${String(step.step_config.until).slice(0, 16)}` : `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return (step.step_config as unknown as { conditions?: unknown[] }).conditions ? `when ${(step.step_config as unknown as { conditions: unknown[] }).conditions.length} conditions` : `when ${step.step_config.subject ?? "?"}`
    case "randomizer":
      return `random ${((step.step_config as unknown as { variants?: unknown[] }).variants?.length ?? 0)} ways`
    case "goal":
      return `goal: ${(step.step_config as unknown as { condition?: { subject?: string } }).condition?.subject ?? "?"}`
    case "enroll_in_sequence":
      return (step.step_config.sequence_id as string) ? `enroll ${(step.step_config.sequence_id as string).slice(0, 8)}…` : "pick sequence"
    case "send_webhook":
      return (step.step_config.url as string) || "no url"
    case "create_task":
      return (step.step_config.title as string) || "new task"
    case "create_deal":
      return (step.step_config.title as string) || "new deal"
    case "add_tag":
    case "remove_tag":
      return (step.step_config.tag_id as string) ? "tag" : "pick a tag"
    case "update_contact_field":
      return (step.step_config.field as string) || "field"
    case "assign_conversation":
      return (step.step_config.mode as string) || "assign"
    case "close_conversation":
      return "close"
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

function HistoryDialog({ open, onClose, automationId, onRestore }: { open: boolean; onClose: () => void; automationId?: string; onRestore: () => void }) {
  const [versions, setVersions] = useState<Array<{ version_number: number; created_at: string; is_published: boolean }>>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open || !automationId) return
    setLoading(true)
    fetch(`/api/automations/${automationId}/versions`).then((r) => r.json()).then((j) => {
      setVersions(j.versions ?? [])
      setLoading(false)
    })
  }, [open, automationId])
  async function restore(v: number) {
    if (!automationId) return
    if (!confirm(`Restore version ${v} into draft?`)) return
    const res = await fetch(`/api/automations/${automationId}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version_number: v }) })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: 'failed' }))
      toast.error(j.error ?? 'Restore failed')
      return
    }
    toast.success(`Version ${v} restored to draft`)
    onRestore()
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg p-4 w-full max-w-md max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Version History</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions yet. Publish to create a snapshot.</p> : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.version_number} className="flex items-center justify-between rounded-md border border-border p-2">
                <div>
                  <div className="text-sm font-medium">v{v.version_number} {v.is_published ? '• Published' : ''}</div>
                  <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => restore(v.version_number)}>Restore</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
