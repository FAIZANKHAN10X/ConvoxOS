'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MoreHorizontal, Plus, Zap } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import type { Automation, AutomationStatus } from '@/lib/automation/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';

export function AutomationList({ catalog }: { catalog: CatalogNode[] }) {
  const router = useRouter();
  const canEdit = useCan('send-messages');
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AutomationStatus>('all');
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const byType = useMemo(
    () => new Map(catalog.map((node) => [node.type, node])),
    [catalog]
  );

  async function load() {
    setError(null);
    const response = await fetch('/api/automations');
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? 'Could not load automations');
      setLoading(false);
      return;
    }
    setAutomations(body.automations ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = automations.filter((item) => {
    if (status !== 'all' && item.status !== status) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return item.name.toLowerCase().includes(q);
  });

  async function create() {
    setCreating(true);
    const response = await fetch('/api/automations', { method: 'POST' });
    const body = await response.json();
    setCreating(false);
    if (!response.ok) {
      setError(body.error ?? 'Could not create automation');
      return;
    }
    router.push(`/automations/${body.automation.id}`);
  }

  async function duplicate(id: string) {
    const response = await fetch(`/api/automations/${id}/duplicate`, {
      method: 'POST',
    });
    const body = await response.json();
    if (response.ok) router.push(`/automations/${body.automation.id}`);
  }

  async function remove() {
    if (!pendingDelete) return;
    setDeleting(true);
    const response = await fetch(`/api/automations/${pendingDelete.id}`, {
      method: 'DELETE',
    });
    setDeleting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(
        (body as { error?: string }).error ?? 'Could not delete automation'
      );
      setPendingDelete(null);
      return;
    }
    setAutomations((current) =>
      current.filter((item) => item.id !== pendingDelete.id)
    );
    setPendingDelete(null);
  }

  async function toggle(item: Automation) {
    const path =
      item.status === 'disabled'
        ? `/api/automations/${item.id}/enable`
        : `/api/automations/${item.id}/disable`;
    const response = await fetch(path, { method: 'POST' });
    if (response.ok) void load();
  }

  function triggerLabel(item: Automation): string {
    const trigger = item.draftTrigger;
    if (!trigger) return 'No trigger';
    return byType.get(trigger.type)?.label ?? trigger.type;
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Automations
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Free-form canvas builder for multi-channel messaging and CRM workflows.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create automations"
          onClick={() => setNewOpen(true)}
          disabled={creating}
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          New Automation
        </GatedButton>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {automations.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-card/40">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Zap className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            No automations yet
          </p>
          <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
            Start from scratch and build a trigger → message flow on the canvas.
          </p>
          <GatedButton
            canAct={canEdit}
            gateReason="create automations"
            onClick={() => setNewOpen(true)}
            size="sm"
            className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            New Automation
          </GatedButton>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search automations..."
              className="h-8 max-w-xs text-xs bg-card border-border/70 text-foreground placeholder:text-muted-foreground"
            />
            {(
              [
                ['all', 'All'],
                ['published', 'Live'],
                ['draft', 'Draft'],
                ['disabled', 'Off'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  status === key
                    ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                    : 'border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 bg-card px-3.5 py-2.5 shadow-xs transition-colors hover:border-border hover:bg-muted/40"
                onClick={() => router.push(`/automations/${item.id}`)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {item.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {triggerLabel(item)}
                    <span className="mx-1 text-muted-foreground/60">·</span>
                    {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                    item.status === 'published'
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                      : item.status === 'disabled'
                        ? 'border-border/60 bg-muted/60 text-muted-foreground'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                  }`}
                >
                  {item.status === 'published'
                    ? 'Live'
                    : item.status === 'disabled'
                      ? 'Off'
                      : 'Draft'}
                </span>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(event) => {
                          event.stopPropagation();
                          void duplicate(item.id);
                        }}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      {item.status !== 'draft' && (
                        <DropdownMenuItem
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggle(item);
                          }}
                        >
                          {item.status === 'disabled' ? 'Turn on' : 'Turn off'}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDelete(item);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Automation</DialogTitle>
            <DialogDescription>
              Start from a blank canvas. The first step is a trigger — then
              add messages, actions, conditions, and waits.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="h-auto justify-start gap-3 bg-primary py-4 text-left text-white hover:bg-primary-hover"
            onClick={() => void create()}
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
            <span>
              <span className="block font-semibold">Start from scratch</span>
              <span className="block text-xs font-normal text-white/70">
                Open the Flow Builder with a starting trigger
              </span>
            </span>
          </Button>
          <div className="rounded-lg border border-dashed border-border bg-muted/50 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Start from a template
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ready-made flows (welcome series, abandoned chat, lead follow-up)
              are coming soon. Templates will install as editable copies.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this automation?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be permanently removed, including versions and run history.`
                : 'This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
