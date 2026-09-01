'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, BookOpen, MessageSquare, Shield, Zap, FlaskConical, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type AgentStatus = 'draft' | 'paused' | 'live';
type DisplayStatus = 'draft' | 'ready' | 'live';

function toDisplay(status: AgentStatus): DisplayStatus {
  if (status === 'paused') return 'ready';
  return status as DisplayStatus;
}

const STATUS_META: Record<DisplayStatus, { label: string; tone: string; dot: string }> = {
  draft: { label: 'Draft', tone: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  ready: { label: 'Ready', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/20', dot: 'bg-amber-400' },
  live: { label: 'Live', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400' },
};

interface OverviewProps {
  onNavigate: (tab: string) => void;
}

export function AgentOverview({ onNavigate }: OverviewProps) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('draft');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [provider, setProvider] = useState('');
  const [knowledgeCount, setKnowledgeCount] = useState<number | null>(null);
  const [goals, setGoals] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [identity, setIdentity] = useState<{ name?: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, kbRes, goalsRes] = await Promise.all([
        fetch('/api/ai/config').then((r) => r.json().catch(() => ({}))),
        fetch('/api/ai/knowledge').then((r) => r.json().catch(() => ({}))),
        fetch('/api/ai/goals').then((r) => r.json().catch(() => ({}))),
      ]);
      setConfigured(Boolean(cfgRes?.configured));
      const s = (cfgRes?.status as AgentStatus) ?? (cfgRes?.is_active ? (cfgRes?.auto_reply_enabled ? 'live' : 'paused') : 'draft');
      setStatus(s);
      setSystemPrompt(cfgRes?.behaviour?.instructions ?? cfgRes?.system_prompt ?? '');
      setProvider(cfgRes?.provider ?? '');
      setIdentity(cfgRes?.identity ?? null);
      if (Array.isArray(kbRes?.documents)) setKnowledgeCount(kbRes.documents.length);
      else if (Array.isArray(kbRes)) setKnowledgeCount(kbRes.length);
      else setKnowledgeCount(0);
      setGoals(Array.isArray(goalsRes?.goals) ? goalsRes.goals : []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const displayStatus = toDisplay(status);
  const meta = STATUS_META[displayStatus];

  const updateStatus = async (next: AgentStatus) => {
    // Guard: require configured + instructions before live
    if (next === 'live') {
      if (!configured) {
        alert('Configure the agent first (provider and model).');
        return;
      }
      if (systemPrompt.trim().length <= 10) {
        alert('Add behaviour instructions before going live.');
        return;
      }
    }
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Failed to update status');
        return;
      }
      setStatus(next);
    } catch {
      alert('Failed to update status');
    }
  };

  const readiness: { label: string; ok: boolean; action?: string; tab?: string }[] = [
    { label: 'Agent configured', ok: configured, action: !configured ? 'Complete setup' : undefined, tab: 'configure' },
    { label: 'Behaviour defined', ok: systemPrompt.trim().length > 10, action: systemPrompt.trim().length <= 10 ? 'Add instructions' : undefined, tab: 'configure' },
    { label: 'Knowledge ready', ok: (knowledgeCount ?? 0) > 0, action: (knowledgeCount ?? 0) === 0 ? 'Teach your agent' : undefined, tab: 'knowledge' },
    { label: 'Live on inbox', ok: status === 'live', action: status !== 'live' ? 'Go live' : undefined, tab: 'test' },
  ];

  const allReady = readiness.slice(0, 3).every((r) => r.ok);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero — who is this agent, is it live, what next */}
      <Card className="overflow-hidden border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  Convox AI Agent
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', meta.tone)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                    {meta.label}
                  </span>
                </CardTitle>
                <CardDescription className="mt-1 max-w-[52ch] text-sm">
                  One agent for the whole workspace. It answers from your knowledge, drafts replies for the team, and can auto-reply when you go live.
                </CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={() => onNavigate(status === 'live' ? 'test' : 'configure')} className="hidden sm:inline-flex">
              {status === 'live' ? (
                <>
                  <FlaskConical className="mr-2 h-4 w-4" /> Test agent
                </>
              ) : allReady ? (
                <>
                  <Zap className="mr-2 h-4 w-4" /> Go live
                </>
              ) : (
                <>
                  Configure <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* 3-step mental model */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Teach</p>
                <p className="text-xs text-muted-foreground">
                  {knowledgeCount === null ? 'Loading…' : knowledgeCount === 0 ? 'No sources yet — add your FAQs, policies, links.' : `${knowledgeCount} source${knowledgeCount === 1 ? '' : 's'} ready`}
                </p>
                <button onClick={() => onNavigate('knowledge')} className="mt-1 text-xs font-medium text-primary hover:underline">
                  {knowledgeCount === 0 ? 'Add knowledge →' : 'Manage →'}
                </button>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Behave</p>
                <p className="text-xs text-muted-foreground">
                  {systemPrompt.trim().length > 10 ? 'Instructions set' : 'Tell the agent how to speak and when to hand off.'}
                </p>
                <button onClick={() => onNavigate('configure')} className="mt-1 text-xs font-medium text-primary hover:underline">
                  Edit behaviour →
                </button>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Live</p>
                <p className="text-xs text-muted-foreground">
                  {displayStatus === 'live' ? 'Auto-replying in inbox' : displayStatus === 'ready' ? 'Ready to go live' : 'Draft — not replying yet'}
                </p>
                <button onClick={() => onNavigate(displayStatus === 'live' ? 'test' : 'configure')} className="mt-1 text-xs font-medium text-primary hover:underline">
                  {displayStatus === 'live' ? 'Test now →' : 'Review →'}
                </button>
              </div>
            </div>
          </div>

          {/* Status control — single source of truth */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Status:</span>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(['draft', 'paused', 'live'] as AgentStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', status === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {s === 'draft' ? 'Draft' : s === 'paused' ? 'Paused' : 'Live'}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">• {displayStatus === 'live' ? 'Auto-replying' : displayStatus === 'ready' ? 'Ready to go live' : 'Not answering'}</span>
          </div>

          {/* Channels — honest about current channel-blind reality */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Active channels:</span>
            <Badge variant="secondary" className="rounded-full">WhatsApp</Badge>
            <Badge variant="secondary" className="rounded-full">Telegram</Badge>
            <span className="text-muted-foreground">• Model: {provider || 'not set'}</span>
            {identity?.name && <span className="text-muted-foreground">• {identity.name}</span>}
          </div>

          {/* Goals — what is the agent trying to accomplish? */}
          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goals — what is the agent trying to accomplish?</p>
              <button onClick={() => onNavigate('configure')} className="text-xs font-medium text-primary hover:underline">
                Manage →
              </button>
            </div>
            {goals.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No goals yet — give your agent an outcome to work toward.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {goals.slice(0, 6).map((g) => (
                  <Badge key={g.id} variant="secondary" className="rounded-full">
                    {g.name}
                  </Badge>
                ))}
                {goals.length > 6 && <Badge variant="outline">+{goals.length - 6} more</Badge>}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{goals.length} active goal{goals.length === 1 ? '' : 's'} • priority order matters for Phase 3</p>
          </div>

          {/* Readiness — why not ready */}
          <div className="mt-4 rounded-lg border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readiness</p>
            <ul className="space-y-1.5">
              {readiness.map((r) => (
                <li key={r.label} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {r.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-400" />
                    )}
                    <span className={cn(r.ok ? 'text-foreground' : 'text-muted-foreground')}>{r.label}</span>
                  </span>
                  {r.action && r.tab && (
                    <button onClick={() => onNavigate(r.tab!)} className="text-xs font-medium text-primary hover:underline">
                      {r.action}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex sm:hidden">
            <Button onClick={() => onNavigate(status === 'live' ? 'test' : 'configure')} className="w-full">
              {status === 'live' ? 'Test agent' : allReady ? 'Go live' : 'Configure agent'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Empty state when draft */}
      {status === 'draft' && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Bot className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Teach your agent first</h3>
            <p className="mt-1 max-w-[36ch] text-sm text-muted-foreground">
              Add what your business does, your FAQs and policies — the agent will answer only from that knowledge and hand off when it isn&apos;t sure.
            </p>
            <Button size="sm" className="mt-4" onClick={() => onNavigate('knowledge')}>
              Add knowledge <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
