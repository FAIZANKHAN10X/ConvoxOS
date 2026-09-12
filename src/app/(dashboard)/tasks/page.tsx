import { createClient } from '@/lib/supabase/server';
import TasksClient from './tasks-client';

// Server-first hybrid (pipelines pattern): open tasks preload via
// RSC so the list renders on first paint. Filters, create/edit,
// and completion stay in the client island. No force-dynamic (T2.3:
// dynamic by default under cacheComponents).
export default async function TasksPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tasks')
    .select('id, title, description, status, due_at, contact_id, assigned_to, deal_id, created_at, contact:contacts(id, name, phone), deal:deals(id, title)')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(100);
  return <TasksClient initialTasks={(data ?? []) as never[]} />;
}
