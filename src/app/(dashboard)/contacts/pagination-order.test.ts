import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// T1.5 regression guard: the numbered contacts UI pages with OFFSET,
// which is only stable under a total ordering. Every contacts
// ordering must carry the id tiebreak or created_at ties (CSV
// imports share one timestamp) shuffle rows between pages.
const root = process.cwd()

describe('contacts ordering tiebreak (T1.5)', () => {
  it('tag-filter RPC orders by (created_at DESC, id DESC)', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/067_contacts_ordering_tiebreak.sql'),
      'utf8'
    )
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/)
  })

  it('server page orders by (created_at desc, id desc)', () => {
    const src = readFileSync(
      join(root, 'src/app/(dashboard)/contacts/page.tsx'),
      'utf8'
    )
    expect(src).toMatch(/order\('created_at', \{ ascending: false \}\)/)
    expect(src).toMatch(/order\('id', \{ ascending: false \}\)/)
  })

  it('client range query orders by (created_at desc, id desc)', () => {
    const src = readFileSync(
      join(root, 'src/app/(dashboard)/contacts/contacts-client.tsx'),
      'utf8'
    )
    expect(src).toMatch(/order\('created_at', \{ ascending: false \}\)/)
    expect(src).toMatch(/order\('id', \{ ascending: false \}\)/)
  })
})
