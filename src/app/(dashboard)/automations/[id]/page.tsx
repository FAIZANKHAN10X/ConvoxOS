"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { AutomationBuilder, fromServerSteps, type BuilderInitial, type ServerStepNode } from "@/components/automations/automation-builder"
import { FlowEditorShell } from "@/components/flows/flow-editor-shell"
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types"
import type { AutomationTriggerType } from "@/types"

type Kind = "automation" | "flow" | null

export default function UnifiedAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const tAuto = useTranslations("Automations.edit")
  const tFlow = useTranslations("Flows.edit")

  const [kind, setKind] = useState<Kind>(null)
  const [automationInitial, setAutomationInitial] = useState<BuilderInitial | null>(null)
  const [flow, setFlow] = useState<FlowRow | null>(null)
  const [nodes, setNodes] = useState<FlowNodeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Try automation first
      const aRes = await fetch(`/api/automations/${id}`)
      if (aRes.ok) {
        const body = await aRes.json()
        if (cancelled) return
        setKind("automation")
        setAutomationInitial({
          id: body.automation.id,
          name: body.automation.name ?? "",
          description: body.automation.description ?? "",
          trigger_type: body.automation.trigger_type as AutomationTriggerType,
          trigger_config: body.automation.trigger_config ?? {},
          is_active: !!body.automation.is_active,
          steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
        })
        setLoading(false)
        return
      }
      if (aRes.status !== 404) {
        if (!cancelled) {
          setError(tAuto("loadError", { status: aRes.status }))
          setLoading(false)
        }
        return
      }
      // Fallback: try flow (compat for flow-origin automations shown in unified list)
      const fRes = await fetch(`/api/flows/${id}`)
      if (fRes.ok) {
        const json = (await fRes.json()) as { flow: FlowRow; nodes: FlowNodeRow[] }
        if (cancelled) return
        setKind("flow")
        setFlow(json.flow)
        setNodes(json.nodes ?? [])
        setLoading(false)
        return
      }
      if (!cancelled) {
        setError(fRes.status === 404 ? tFlow("notFound") : tAuto("loadError", { status: fRes.status }))
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, tAuto, tFlow])

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error || (!automationInitial && !flow)) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error ?? tAuto("loadError", { status: 404 })}</p>
        <button onClick={() => router.push("/automations")} className="text-sm text-primary hover:text-primary/80">
          {tAuto("back")}
        </button>
      </div>
    )
  }

  if (kind === "flow" && flow) {
    return <FlowEditorShell initialFlow={flow} initialNodes={nodes} />
  }

  if (automationInitial) {
    return <AutomationBuilder initial={automationInitial} />
  }

  return null
}
