import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getContactActivityFeed } from '@/lib/activity/feed'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
  const accountId = (profile as { account_id: string } | null)?.account_id
  if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 400 })

  // Verify contact belongs to account
  const { data: contact } = await supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', accountId).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 100)
  const cursor = url.searchParams.get('cursor')
  const filter = (url.searchParams.get('filter') ?? 'all') as string

  // Use service role for activity fetch to bypass RLS joins, but we already verified account/contact
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { items, nextCursor } = await getContactActivityFeed(admin as never, {
    contactId,
    accountId,
    limit,
    cursor,
    filter: filter as never,
  })

  return NextResponse.json({ items, nextCursor })
}
