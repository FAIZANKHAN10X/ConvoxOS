import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiGoal } from './types';

export async function loadGoalsForAgent(supabase: SupabaseClient, accountId: string, aiConfigId: string): Promise<AiGoal[]> {
  const { data, error } = await supabase
    .from('ai_goals')
    .select('*')
    .eq('account_id', accountId)
    .eq('ai_config_id', aiConfigId)
    .eq('enabled', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    aiConfigId: row.ai_config_id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    kind: row.kind as AiGoal['kind'],
    description: row.description as string | null,
    params: (row.params as Record<string, unknown>) ?? {},
    priority: row.priority as number,
    enabled: row.enabled as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function recordGoalCompletion(
  supabase: SupabaseClient,
  args: { goalId: string; aiConfigId: string; accountId: string; conversationId?: string; contactId?: string; metadata?: Record<string, unknown> },
) {
  const { error } = await supabase.from('ai_goal_completions').insert({
    ai_goal_id: args.goalId,
    ai_config_id: args.aiConfigId,
    account_id: args.accountId,
    conversation_id: args.conversationId ?? null,
    contact_id: args.contactId ?? null,
    metadata: args.metadata ?? {},
  });
  if (error) throw error;
}

export function isCaptureLeadComplete(goal: AiGoal, contact: { email?: string | null; phone?: string | null; name?: string | null }): boolean {
  if (goal.kind !== 'capture_lead') return false;
  const fields = (goal.params.fields as string[] | undefined) ?? ['email', 'phone'];
  for (const f of fields) {
    const v = (contact as Record<string, unknown>)[f];
    if (!v || String(v).trim() === '') return false;
  }
  return true;
}

export function isShareLinkComplete(metadata: Record<string, unknown> | null): boolean {
  // Share link is complete when a send_message tool with the link succeeded
  // For now, we check metadata.sentLink
  return Boolean(metadata && (metadata as { sentLink?: boolean }).sentLink);
}
