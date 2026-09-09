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
        <Loader2 className="h-6 w-6 animate-spin text-[#2f6fed]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
            Automation
          </p>
          <h1 className="text-foreground mt-1 text-2xl font-bold">
            My Automations
          </h1>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create automations"
          onClick={() => setNewOpen(true)}
          disabled={creating}
        >
          <Plus className="h-4 w-4" />
          New Automation
        </GatedButton>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {automations.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3a4150] text-white">
            <Zap className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-slate-800">
            No automations yet
          </p>
          <p className="mt-1 max-w-sm text-center text-xs text-slate-500">
            Start from scratch and build a trigger → message flow on the canvas.
          </p>
          <GatedButton
            canAct={canEdit}
            gateReason="create automations"
            onClick={() => setNewOpen(true)}
            className="mt-4"
          >
            <Plus className="h-4 w-4" />
            New Automation
          </GatedButton>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search automations"
              className="max-w-xs"
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
                className={`rounded-full border px-3 py-1 text-xs ${
                  status === key
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-3">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex cursor-pointer items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300"
                onClick={() => router.push(`/automations/${item.id}`)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3a4150] text-white">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {triggerLabel(item)}
                    <span className="mx-1.5 text-slate-300">·</span>
                    {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    item.status === 'published'
                      ? 'bg-emerald-50 text-emerald-700'
                      : item.status === 'disabled'
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-amber-50 text-amber-700'
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
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
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
            className="h-auto justify-start gap-3 bg-[#2f6fed] py-4 text-left text-white hover:bg-[#2559c4]"
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
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">
              Start from a template
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Ready-made flows (welcome series, abandoned chat, lead follow-up)
              are coming soon. Templates will install as editable copies.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
