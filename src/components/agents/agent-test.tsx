'use client';

import { useState } from 'react';
import { AiPlayground } from './ai-playground';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlaskConical, Zap } from 'lucide-react';

const STARTERS = [
  'Hi, do you ship internationally?',
  'What is the return policy?',
  'Can I speak to a human?',
  'Do you have this in stock?',
];

interface AgentTestProps {
  onGoToSetup?: () => void;
}

export function AgentTest({ onGoToSetup }: AgentTestProps) {
  const [starter, setStarter] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-primary" /> Test your agent
          </CardTitle>
          <CardDescription>
            Send a message as if you were a customer. The agent replies using your knowledge and the behaviour you configured — including the handoff to a human when it isn&apos;t sure.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="secondary" className="rounded-full">
              WhatsApp + Telegram
            </Badge>
            <span className="text-xs text-muted-foreground">• Knowledge-aware • handoff-aware • no CRM writes in Phase 1</span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Try a starter</p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <Button key={s} variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => setStarter(s)}>
                {s}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Tip: test an unanswerable question — the agent should hand off instead of guessing. That&apos;s how you verify your Knowledge is working.
          </p>
        </CardContent>
      </Card>

      {/* Playground — key forces remount when starter picked so textarea is seeded */}
      <AiPlayground key={starter ?? 'empty'} onGoToSetup={onGoToSetup} initialInput={starter ?? undefined} />

      <p className="text-center text-xs text-muted-foreground">
        Future: channel selector, contact persona, and source citations will appear here (Phase 3+).
      </p>
    </div>
  );
}
