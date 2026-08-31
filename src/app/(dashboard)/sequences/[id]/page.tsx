"use client"
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { validateSequenceForActivation } from '@/lib/sequences/validate'

type Step = { id?: string; position: number; step_type: string; step_config: Record<string, unknown> }

export default function SequenceEditPage() {
  const params = useParams() as { id: string }
  const id = params.id
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState<Array<{ path: string; message: string }>>([])

  async function load() {
    const supabase = createClient()
    const { data: seq } = await supabase.from('sequences').select('name').eq('id', id).maybeSingle()
    if (seq) setName((seq as { name: string }).name)
    const { data: st } = await supabase.from('sequence_steps').select('*').eq('sequence_id', id).order('position')
    setSteps(((st as unknown as Step[]) ?? []).map((s, i) => ({ ...s, position: i })))
    setLoading(false)
  }

  useEffect(() => { void load() }, [id])

  function addStep(type: string) {
    const base: Record<string, unknown> = type === 'send_message' ? { text: '', channel_target: 'whatsapp' } : type === 'wait' ? { amount: 1, unit: 'hours' } : { body: 'Choose', buttons: [{ id: 'a', title: 'A' }], channel_target: 'whatsapp' }
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
      <h1 className="text-2xl font-semibold">Edit Sequence</h1>
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Steps (ordered)</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => addStep('send_message')}>+ Message</Button>
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
    </div>
  )
}
