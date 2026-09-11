'use client';

import { useEffect, useState } from 'react';
import { Bot, BookOpen, FlaskConical, Settings2, BarChart3, LayoutDashboard } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { AiKnowledgeCard } from '@/components/settings/ai-knowledge';
import { AgentOverview } from '@/components/agents/agent-overview';
import { AgentTest } from '@/components/agents/agent-test';
import { AgentConfigure } from '@/components/agents/agent-configure';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'overview' | 'configure' | 'knowledge' | 'test' | 'activity';

export default function AgentsPage() {
  const { accountRole, accountId } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('overview');
  const [decided, setDecided] = useState(false);

  // Land first-time users on Overview → Configure, returning users stay on Overview.
  // Overview is now the single mental-model entry point.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          // If never configured, nudge to Configure, otherwise Overview.
          setTab(data?.configured ? 'overview' : 'configure');
        }
      } catch {
        if (!cancelled) setTab('configure');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">AI Agent</h1>
          <p className="text-[13px] text-muted-foreground">One agent for the workspace — teach it, test it, then go live.</p>
        </div>
      </div>

      {!decided ? (
        <div className="mt-6 h-64 animate-pulse rounded-lg border border-border/70 bg-card" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
          <div className="overflow-x-auto">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">
                <LayoutDashboard className="mr-1.5 h-4 w-4" /> Overview
              </TabsTrigger>
              <TabsTrigger value="configure">
                <Settings2 className="mr-1.5 h-4 w-4" /> Configure
              </TabsTrigger>
              <TabsTrigger value="knowledge">
                <BookOpen className="mr-1.5 h-4 w-4" /> Knowledge
              </TabsTrigger>
              <TabsTrigger value="test">
                <FlaskConical className="mr-1.5 h-4 w-4" /> Test
              </TabsTrigger>
              {canViewUsage && (
                <TabsTrigger value="activity">
                  <BarChart3 className="mr-1.5 h-4 w-4" /> Activity
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-4">
            <AgentOverview onNavigate={(t) => setTab(t as Tab)} />
          </TabsContent>

          <TabsContent value="configure" className="mt-4 space-y-6">
            {/* New IA: Identity/Behaviour/Advanced (local) + existing provider wiring */}
            <AgentConfigure />
            <div className="rounded-lg border border-dashed border-border/70 p-1">
              <AiConfig />
            </div>
            <p className="text-xs text-muted-foreground">
              Provider & keys live in Advanced — the behaviour card above is where you shape the agent.
            </p>
          </TabsContent>

          <TabsContent value="knowledge" className="mt-4">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">What does your agent know?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add your business information, FAQs, policies and links. The agent answers only from this knowledge and hands off when it isn&apos;t sure. Future: URLs and files.
                </p>
              </div>
              {/* Knowledge is account-scoped; reuse existing card with server props */}
              <KnowledgeStandalone accountId={accountId} />
            </div>
          </TabsContent>

          <TabsContent value="test" className="mt-4">
            <AgentTest onGoToSetup={() => setTab('configure')} />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="activity" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

function KnowledgeStandalone({ accountId }: { accountId: string | null }) {
  // Lazy gate: AiKnowledgeCard already handles null accountId + canEdit.
  // We derive canEdit locally and hasEmbeddingsKey via a tiny fetch — reuse existing wiring.
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  // hasEmbeddingsKey is optional for first-class surface — show keyword hint until verified.
  return <AiKnowledgeCard accountId={accountId} canEdit={canEdit} hasEmbeddingsKey={false} />;
}
