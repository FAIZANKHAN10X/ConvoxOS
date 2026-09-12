import { createClient } from '@/lib/supabase/server';

import { AppointmentsClient } from './appointments-client';

// Server-first hybrid (tasks pattern): appointments preload via
// RSC; booking and status moves stay in the client island.
export default async function AppointmentsPage() {
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
        .from('appointments')
        .select(
          'id, title, starts_at, ends_at, status, notes, created_at, contact:contacts(id, name, phone)'
        )
        .eq('account_id', accountId)
        .order('starts_at', { ascending: true })
        .limit(200)
    : { data: [] };
  return <AppointmentsClient initialAppointments={(data ?? []) as never[]} />;
}
