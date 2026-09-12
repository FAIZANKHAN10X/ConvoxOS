"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

import Link from 'next/link'

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Array<{ id: string; name: string; is_active: boolean }>>([])
  const [counts, setCounts] = useState<Record<string, { active: number; total: number }>>({})
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    const supabase = createClient()
    const { data } = await supabase.from('sequences').select('id, name, is_active').order('created_at', { ascending: false })
    setSequences((data as unknown as typeof sequences) ?? [])
    // Enrollment counts per sequence for visibility (narrow rows only).
    const { data: enr } = await supabase.from('sequence_enrollments').select('sequence_id, status')
    const next: Record<string, { active: number; total: number }> = {}
    for (const row of ((enr as unknown as Array<{ sequence_id: string; status: string }>) ?? [])) {
      const entry = next[row.sequence_id] ?? { active: 0, total: 0 }
      entry.total += 1
      if (row.status === 'active') entry.active += 1
      next[row.sequence_id] = entry
    }
    setCounts(next)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [])

  async function create() {
    if (!name.trim()) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // Get account_id from profiles
    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
    const accountId = (profile as { account_id: string } | null)?.account_id
    if (!accountId) return
    await supabase.from('sequences').insert({ account_id: accountId, user_id: user.id, name: name.trim(), is_active: false })
    setName('')
    void load()
  }

  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Sequences</h1>
      <p className="text-sm text-muted-foreground">Linear drip sequences — ordered steps with waits. Enroll via automation &quot;Enroll in Sequence&quot;.</p>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New sequence name" className="max-w-sm" />
        <Button onClick={create}>Create</Button>
      </div>
      <div className="grid gap-3">
        {sequences.map((s) => (
          <Card key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.is_active ? 'Active' : 'Draft'}
                {counts[s.id] ? ` · ${counts[s.id].active} active / ${counts[s.id].total} enrolled` : ''}
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/sequences/${s.id}`}>
                <Button variant="outline" size="sm">Open</Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(s.id) }}>Copy ID</Button>
            </div>
          </Card>
        ))}
        {sequences.length === 0 && <p className="text-sm text-muted-foreground">No sequences yet. Create one to enroll contacts via automations.</p>}
      </div>
    </div>
  )
}
