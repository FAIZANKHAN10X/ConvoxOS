'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { AutomationRun, RunStep } from '@/lib/automation/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type HistoryRun = AutomationRun & {
  contactName?: string | null;
  versionNumber?: number | null;
};

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  completed: 'secondary',
  failed: 'destructive',
  waiting: 'outline',
  running: 'default',
  queued: 'outline',
  cancelled: 'outline',
};

export function HistoryPanel({ automationId }: { automationId: string }) {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/automations/${automationId}/runs`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Failed to load runs');
        if (!cancelled) setRuns(body.runs ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load runs');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  async function openRun(runId: string) {
    setOpenId(runId);
    const response = await fetch(
      `/api/automations/${automationId}/runs/${runId}`
    );
    const body = await response.json();
    if (response.ok) setSteps(body.steps ?? []);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <p className="text-destructive p-6 text-sm">{error}</p>;
  }
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        No runs yet. Publish this automation and wait for a matching CRM event.
      </p>
    );
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="border-border/70 bg-card overflow-hidden rounded-lg border shadow-xs">
        <ul className="divide-border divide-y">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => void openRun(run.id)}
                className={cn(
                  'hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                  openId === run.id && 'bg-muted/70'
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {run.contactName ?? 'Contact'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(run.createdAt).toLocaleString()}
                    {run.versionNumber != null
                      ? ` · v${run.versionNumber}`
                      : ''}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'}>
                  {run.status}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-border/70 bg-card rounded-lg border p-4 shadow-xs">
        {!openId ? (
          <p className="text-muted-foreground text-sm">Select a run.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">Steps</p>
            {steps.length === 0 ? (
              <p className="text-muted-foreground text-xs">No step history.</p>
            ) : (
              <ol className="space-y-2">
                {steps.map((step) => (
                  <li
                    key={step.id}
                    className="border-border rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">{step.nodeType}</span>
                      <Badge
                        variant={
                          step.status === 'failed' ? 'destructive' : 'secondary'
                        }
                      >
                        {step.status}
                      </Badge>
                    </div>
                    {step.attempt > 1 && (
                      <p className="text-muted-foreground text-xs">
                        Attempt {step.attempt}
                      </p>
                    )}
                    {step.error && (
                      <p className="text-destructive mt-1 text-xs">
                        {step.error}
                      </p>
                    )}
                    {step.output && Object.keys(step.output).length > 0 && (
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpenId(null);
                setSteps([]);
              }}
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
