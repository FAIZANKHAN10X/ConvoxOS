"use client"
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { validateSequenceForActivation } from '@/lib/sequences/validate'
import { loadSequenceAnalytics, type SequenceAnalytics } from '@/lib/sequences/analytics'

type Step = { id?: string; position: number; step_type: string; step_config: Record<string, unknown> }
type Enrollment = {
  id: string;
  contact_id: string;
  status: string;
  current_position: number;
  next_run_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  contact?: { name: string | null; phone: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function SequenceEditPage() {
  const params = useParams() as { id: string }
  const id = params.id
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState<Array<{ path: string; message: string }>>([])
  const [isActive, setIsActive] = useState(false)
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [analytics, setAnalytics] = useState<SequenceAnalytics | null>(null)
  const [actingOn, setActingOn] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data: seq } = await supabase.from('sequences').select('name, is_active, account_id').eq('id', id).maybeSingle()
    if (seq) {
      setName((seq as { name: string }).name)
      setIsActive(!!(seq as { is_active: boolean }).is_active)
    }
    const { data: st } = await supabase.from('sequence_steps').select('*').eq('sequence_id', id).order('position')
    setSteps(((st as unknown as Step[]) ?? []).map((s, i) => ({ ...s, position: i })))
    const { data: enr } = await supabase
      .from('sequence_enrollments')
      .select('id, contact_id, status, current_position, next_run_at, cancelled_reason, created_at, contact:contacts(name, phone)')
      .eq('sequence_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
    setEnrollments(((enr as unknown as Enrollment[]) ?? []))
    // Analytics summary (T4.4): single RPC, fails soft — the list
    // above is the source of truth, this row is a convenience.
    try {
      const accountId = (seq as { account_id?: string } | null)?.account_id
      if (accountId) {
        setAnalytics(await loadSequenceAnalytics(supabase, accountId, id))
      }
    } catch {
      setAnalytics(null)
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [id])

  function addStep(type: string) {
    const base: Record<string, unknown> = type === 'send_message' ? { text: '', channel_target: 'whatsapp' } : type === 'send_email' ? { subject: '', text: '' } : type === 'wait' ? { amount: 1, unit: 'hours' } : { body: 'Choose', buttons: [{ id: 'a', title: 'A' }], channel_target: 'whatsapp' }
    setSteps((prev) => [...prev, { position: prev.length, step_type: type, step_config: base }])
  }

  function updateStep(idx: number, patch: Record<string, unknown>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, step_config: { ...s.step_config, ...patch } } : s)))
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i })))
  }

  function move(idx: number, dir: number) {
    setSteps((prev) => {
      const arr = [...prev]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return prev
      const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp
      return arr.map((s, i) => ({ ...s, position: i }))
    })
  }

  async function toggleActive() {
    const supabase = createClient()
    const { error } = await supabase.from('sequences').update({ is_active: !isActive }).eq('id', id)
    if (!error) setIsActive(!isActive)
  }

  async function enrollmentAction(enrollmentId: string, action: 'pause' | 'resume' | 'cancel') {
    setActingOn(enrollmentId)
    try {
      const res = await fetch(`/api/sequences/enrollments/${enrollmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch {
      // Toast handled by caller convention; reload shows truth regardless
    } finally {
      setActingOn(null)
      void load()
    }
  }

  function enrollmentLabel(e: Enrollment): string {
    const contact = e.contact?.name || e.contact?.phone || e.contact_id.slice(0, 8)
    const step = `${e.current_position + 1}/${steps.length || '?'}`
    const reason = e.status === 'cancelled' && e.cancelled_reason ? ` (${e.cancelled_reason})` : ''
    return `${contact} · step ${step}${reason}`
  }

  async function save() {
    setSaving(true)
    const supabase = createClient()
    const issues = validateSequenceForActivation(name, steps as never)
    setValidation(issues)
    if (issues.length > 0) {
      setSaving(false)
      return
    }
    await supabase.from('sequences').update({ name }).eq('id', id)
    // Replace steps: delete and re-insert (simple for P2-C)
    await supabase.from('sequence_steps').delete().eq('sequence_id', id)
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      await supabase.from('sequence_steps').insert({ sequence_id: id, position: i, step_type: s.step_type, step_config: s.step_config })
    }
    setSaving(false)
    void load()
  }

  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit Sequence</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleActive}
          title={isActive ? 'Deactivate: sweeps skip enrollments of inactive sequences' : 'Activate: allow new enrollments and sweeps'}
        >
          {isActive ? 'Active' : 'Draft'}
        </Button>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {validation.length > 0 && (
        <Card className="p-3 bg-amber-500/10 border-amber-500/20">
          <div className="text-sm font-medium text-amber-600">Validation issues</div>
          <ul className="list-disc pl-5 text-xs text-amber-700">
            {validation.map((v, i) => <li key={i}>{v.path}: {v.message}</li>)}
          </ul>
        </Card>
      )}

      {analytics && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="Sequence analytics">
          {(
            [
              ['Enrolled', analytics.enrolled],
              ['Active', analytics.active],
              ['Completed', analytics.completed],
              ['Stopped', analytics.stopped],
              ['Failed', analytics.failed],
              ['Sent', analytics.sent],
              ['Replied', analytics.replied],
            ] as Array<[string, number]>
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/70 bg-card px-2 py-2 text-center shadow-xs">
              <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Steps (ordered)</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => addStep('send_message')}>+ Message</Button>
            <Button size="sm" variant="outline" onClick={() => addStep('send_email')}>+ Email</Button>
            <Button size="sm" variant="outline" onClick={() => addStep('wait')}>+ Wait</Button>
            <Button size="sm" variant="outline" onClick={() => addStep('send_buttons')}>+ Buttons</Button>
          </div>
        </div>
        {steps.map((s, idx) => (
          <Card key={idx} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">{idx + 1}. {s.step_type}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</Button>
                <Button size="sm" variant="ghost" disabled={idx === steps.length - 1} onClick={() => move(idx, 1)}>↓</Button>
                <Button size="sm" variant="ghost" onClick={() => removeStep(idx)}>Remove</Button>
              </div>
            </div>
            {s.step_type === 'send_message' && (
              <>
                <Input value={(s.step_config.text as string) ?? ''} onChange={(e) => updateStep(idx, { text: e.target.value })} placeholder="Message text" />
                <select value={(s.step_config.channel_target as string) ?? 'whatsapp'} onChange={(e) => updateStep(idx, { channel_target: e.target.value })} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="current">Current</option>
                </select>
              </>
            )}
            {s.step_type === 'send_email' && (
              <>
                <Input value={(s.step_config.subject as string) ?? ''} onChange={(e) => updateStep(idx, { subject: e.target.value })} placeholder="Email subject" />
                <Input value={(s.step_config.text as string) ?? ''} onChange={(e) => updateStep(idx, { text: e.target.value })} placeholder="Email body" />
              </>
            )}
            {s.step_type === 'wait' && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min={1} value={(s.step_config.amount as number) ?? 1} onChange={(e) => updateStep(idx, { amount: Math.max(1, Number(e.target.value) || 1) })} />
                <select value={(s.step_config.unit as string) ?? 'hours'} onChange={(e) => updateStep(idx, { unit: e.target.value })} className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
                <Input type="datetime-local" value={(s.step_config.until as string) ? String(s.step_config.until).slice(0, 16) : ''} onChange={(e) => updateStep(idx, { until: e.target.value ? new Date(e.target.value).toISOString() : undefined })} placeholder="Until (optional)" className="col-span-2" />
              </div>
            )}
            {(s.step_type === 'send_buttons' || s.step_type === 'send_list') && (
              <Textarea value={JSON.stringify(s.step_config, null, 2)} onChange={(e) => {
                try { const parsed = JSON.parse(e.target.value); updateStep(idx, parsed) } catch {}
              }} className="font-mono text-xs min-h-24" />
            )}
          </Card>
        ))}
        {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet. Add a message or wait to start.</p>}
      </div>

      <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>

      <div className="space-y-3 pt-2">
        <h2 className="font-medium">Enrollments ({enrollments.length})</h2>
        {enrollments.length === 0 && (
          <p className="text-sm text-muted-foreground">No enrollments yet. Enroll contacts via automations.</p>
        )}
        {enrollments.map((e) => (
          <Card key={e.id} className="p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{enrollmentLabel(e)}</div>
              <div className="text-xs text-muted-foreground">
                {STATUS_LABEL[e.status] ?? e.status}
                {e.next_run_at && e.status === 'active' ? ` · next ${new Date(e.next_run_at).toLocaleString()}` : ''}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {e.status === 'active' && (
                <Button size="sm" variant="outline" disabled={actingOn === e.id} onClick={() => enrollmentAction(e.id, 'pause')}>Pause</Button>
              )}
              {e.status === 'paused' && (
                <Button size="sm" variant="outline" disabled={actingOn === e.id} onClick={() => enrollmentAction(e.id, 'resume')}>Resume</Button>
              )}
              {(e.status === 'active' || e.status === 'paused') && (
                <Button size="sm" variant="ghost" disabled={actingOn === e.id} onClick={() => enrollmentAction(e.id, 'cancel')}>Cancel</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
