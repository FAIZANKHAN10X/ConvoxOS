import { createClient } from '@/lib/supabase/server';

import { FormsClient } from './forms-client';

// Server-first hybrid (tasks pattern): forms preload via RSC;
// create/edit, submissions, and link copy stay in the client island.
export default async function FormsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null };
  const accountId = (profile as { account_id: string } | null)?.account_id;
  const { data } = accountId
    ? await supabase
        .from('lead_forms')
        .select('id, name, fields, is_active, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] };
  return <FormsClient initialForms={(data ?? []) as never[]} />;
}
