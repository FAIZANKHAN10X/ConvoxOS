import { createClient } from '@/lib/supabase/server'
import { ContactsClient } from './contacts-client'

export const dynamic = 'force-dynamic'

// Server-first hybrid: initial page (25 contacts + tags) loads via RSC
// in a single server hop, eliminating the browser waterfall
// tags → contacts → contact_tags. Subsequent pagination/search/tag
// filtering stays client-driven via ContactsClient's existing fetches.
export default async function ContactsPage() {
  const supabase = await createClient()

  const [{ data: tagsData }, { data: contactsData, count }] = await Promise.all([
    supabase.from('tags').select('*').order('name'),
    // Total ordering (created_at DESC, id DESC) keeps offset pages
    // stable across ties — CSV imports share one timestamp, and
    // without the id tiebreak rows shuffle between pages (T1.5).
    supabase.from('contacts').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 24),
  ])

  const tags = (tagsData ?? []) as unknown as import('@/types').Tag[]
  const contacts = (contactsData ?? []) as unknown as import('@/types').Contact[]
  const contactIds = contacts.map((c) => c.id)

  let contactTags: import('@/types').ContactTag[] = []
  if (contactIds.length > 0) {
    const { data } = await supabase.from('contact_tags').select('contact_id, tag_id').in('contact_id', contactIds)
    contactTags = (data ?? []) as unknown as import('@/types').ContactTag[]
  }

  const tagsById = new Map(tags.map((t) => [t.id, t]))
  const contactsWithTags = contacts.map((contact) => {
    const tagIds = contactTags.filter((ct) => ct.contact_id === contact.id).map((ct) => ct.tag_id)
    const tagObjs = tagIds.map((id) => tagsById.get(id)).filter(Boolean) as import('@/types').Tag[]
    return { ...contact, tags: tagObjs }
  })

  return <ContactsClient initialContacts={contactsWithTags} initialTotalCount={count ?? 0} initialTags={tags} />
}
