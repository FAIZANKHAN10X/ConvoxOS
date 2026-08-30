"use client"
import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

// Thin adapter: canonical Runs entry for unified Automations product.
// Deterministic origin: try automations first, then flows. No duplicate records.
export default function UnifiedRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [origin, setOrigin] = useState<"automation" | "flow" | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data: a } = await supabase.from("automations").select("id").eq("id", id).maybeSingle()
      if (!cancelled) {
        if (a) { setOrigin("automation"); setChecked(true); return }
        const { data: f } = await supabase.from("flows").select("id").eq("id", id).maybeSingle()
        if (!cancelled) {
          if (f) setOrigin("flow")
          else setOrigin(null)
          setChecked(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (!checked) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  if (origin === "automation") {
    // Reuse logs UI via redirect to existing logs route to avoid duplicating large component
    // Keep history clean: replace
    router.replace(`/automations/${id}/logs`)
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }
  if (origin === "flow") {
    // For flow-origin, show flow runs inline by delegating to existing API
    return <FlowRunsInline id={id} />
  }
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">Automation not found.</p>
      <Button variant="outline" onClick={() => router.push("/automations")}>Back to Automations</Button>
    </div>
  )
}

function FlowRunsInline({ id }: { id: string }) {
  const router = useRouter()
  const [data, setData] = useState<{ flow: { id: string; name: string } | null, runs: unknown[], events: unknown[] } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/flows/${id}/runs`)
        if (res.ok) {
          const j = await res.json()
          setData(j)
        }
      } finally { setLoading(false) }
    })()
  }, [id])
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  if (!data?.flow) return <div className="flex h-64 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">No runs</p><Button variant="ghost" onClick={() => router.push(`/automations/${id}`)}>Back</Button></div>
  // Minimal inline: link to legacy flow runs for full timeline (avoid duplicating large component)
  return (
    <div className="mx-auto max-w-4xl p-6">
      <button onClick={() => router.push(`/automations/${id}`)} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" />{data.flow.name}</button>
      <h1 className="text-xl font-semibold">Runs</h1>
      <p className="mt-1 text-sm text-muted-foreground">Flow runs — see <button onClick={() => router.push(`/flows/${id}/runs`)} className="text-primary hover:underline">detailed flow runs</button> or automation logs.</p>
      <div className="mt-4 text-xs text-muted-foreground">{(data.runs as unknown[]).length} runs</div>
    </div>
  )
}
