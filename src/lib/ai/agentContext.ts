import type { SupabaseClient } from '@supabase/supabase-js';
import { buildConversationContext } from './context';
import { retrieveKnowledge, retrieveKnowledgeWithSources } from './knowledge';
import { latestUserMessage } from './query';
import type { AiConfig, AiGoal } from './types';
import { loadGoalsForAgent } from './goals';

export interface AgentContext {
  messages: import('./types').ChatMessage[];
  contact: Record<string, unknown> | null;
  tags: Array<{ id: string; name: string }>;
  deal: Record<string, unknown> | null;
  goals: AiGoal[];
  knowledge: string[];
  knowledgeSources: Array<{ title: string; type: string }>;
  systemPrompt: string;
  hasMoreHistory: boolean;
}

export async function assembleAgentContext(args: {
  supabase: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId?: string;
  config: AiConfig;
}): Promise<AgentContext> {
  const { supabase, accountId, conversationId, contactId, config } = args;

  const messages = await buildConversationContext(supabase, conversationId);
  let hasMoreHistory = false;
  try {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId);
    if (count && count > messages.length) hasMoreHistory = true;
  } catch {
    // ignore
  }

  // Contact + tags + deal (bounded)
  let contact: Record<string, unknown> | null = null;
  let tags: Array<{ id: string; name: string }> = [];
  let deal: Record<string, unknown> | null = null;
  if (contactId) {
    const [{ data: contactRow }, { data: contactTags }, { data: deals }] = await Promise.all([
      supabase.from('contacts').select('id, name, email, phone, company').eq('id', contactId).eq('account_id', accountId).maybeSingle(),
      supabase.from('contact_tags').select('tag_id, tags(id, name)').eq('contact_id', contactId),
      supabase.from('deals').select('id, title, stage_id, pipeline_id, value, status').eq('contact_id', contactId).eq('account_id', accountId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (contactRow) contact = contactRow as unknown as Record<string, unknown>;
    if (contactTags) {
      const raw = contactTags as unknown as Array<{ tags: { id: string; name: string } | { id: string; name: string }[] | null }>;
      tags = raw
        .map((ct) => {
          const t = ct.tags;
          if (!t) return null;
          if (Array.isArray(t)) return t[0] ?? null;
          return t;
        })
        .filter(Boolean) as Array<{ id: string; name: string }>;
    }
    if ((deals as unknown as { id: string } | null)) deal = deals as unknown as Record<string, unknown>;
  }

  // Knowledge (bounded k=3 for tool context) — also keep sources for transparency
  let knowledge: string[] = [];
  let knowledgeSources: Array<{ title: string; type: string }> = [];
  try {
    const withSources = await retrieveKnowledgeWithSources(supabase, accountId, config, latestUserMessage(messages), 3);
    knowledge = withSources.map((s) => s.content);
    knowledgeSources = withSources.map((s) => ({ title: s.sourceTitle ?? 'Knowledge', type: s.sourceType ?? 'text' }));
  } catch {
    knowledge = await retrieveKnowledge(supabase, accountId, config, latestUserMessage(messages), 3).catch(() => [] as string[]);
  }

  // Goals
  let goals: AiGoal[] = [];
  try {
    // Need ai_config_id — fetch from ai_configs
    const { data: cfg } = await supabase.from('ai_configs').select('id').eq('account_id', accountId).maybeSingle();
    if (cfg) goals = await loadGoalsForAgent(supabase, accountId, (cfg as { id: string }).id);
  } catch {
    goals = [];
  }

  // Build system prompt with CRM context
  const crmContext = [
    contact ? `Contact: ${JSON.stringify({ name: contact.name, email: contact.email, phone: contact.phone, company: contact.company })}` : null,
    tags.length ? `Tags: ${tags.map((t) => t.name).join(', ')}` : null,
    deal ? `Deal: ${JSON.stringify({ title: (deal as Record<string, unknown>).title, status: (deal as Record<string, unknown>).status })}` : null,
    goals.length ? `Goals (priority order): ${goals.map((g) => `${g.name} (${g.kind})`).join(' | ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const basePrompt = config.behaviour?.instructions ?? config.systemPrompt ?? '';
  const tone = config.behaviour?.tone ? `Tone: ${config.behaviour.tone}.` : '';
  const length = config.behaviour?.responseLength ? `Response length: ${config.behaviour.responseLength}.` : '';
  const identity = config.identity?.name ? `You are ${config.identity.name}${config.identity.role ? `, a ${config.identity.role}` : ''}.` : '';
  const historyNote = hasMoreHistory ? `Note: +${knowledge.length > 0 ? 'older messages exist beyond the last 20 shown' : 'conversation has older history not shown'} — use get_contact for full CRM context.` : null;
  const knowledgeBlock = knowledge.length
    ? `Knowledge (sources: ${knowledgeSources.map((s) => s.title).join(', ')}):\n${knowledge.map((k, i) => `[${i + 1} ${knowledgeSources[i]?.title ?? 'Knowledge'}] ${k.slice(0, 800)}`).join('\n---\n')}`
    : null;
  const systemPrompt = [identity, tone, length, basePrompt, crmContext ? `CRM context:\n${crmContext}` : null, historyNote, knowledgeBlock].filter(Boolean).join('\n\n');

  return { messages, contact, tags, deal, goals, knowledge, knowledgeSources, systemPrompt, hasMoreHistory };
}
