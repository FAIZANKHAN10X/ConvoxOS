'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical, Target, Link as LinkIcon, Users, Sparkles, Loader2, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

type GoalKind = 'capture_lead' | 'share_link' | 'custom';

interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  description: string | null;
  params: Record<string, unknown>;
  priority: number;
  enabled: boolean;
}

const KIND_LABEL: Record<GoalKind, string> = {
  capture_lead: 'Capture lead',
  share_link: 'Share link',
  custom: 'Custom',
};

const KIND_ICON: Record<GoalKind, typeof Target> = {
  capture_lead: Users,
  share_link: LinkIcon,
  custom: Sparkles,
};

export function AgentGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [saving, setSaving] = useState(false);

  // form state
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GoalKind>('capture_lead');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<string[]>(['email']);
  const [url, setUrl] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/goals');
      const data = await res.json();
      if (res.ok) setGoals(data.goals ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGoals();
  }, [fetchGoals]);

  const openCreate = (k: GoalKind = 'capture_lead') => {
    setEditing(null);
    setName('');
    setKind(k);
    setDescription('');
    setFields(['email']);
    setUrl('');
    setCustomInstructions('');
    setDialogOpen(true);
  };

  const openEdit = (g: Goal) => {
    setEditing(g);
    setName(g.name);
    setKind(g.kind);
    setDescription(g.description ?? '');
    const p = g.params as Record<string, unknown>;
    if (g.kind === 'capture_lead') setFields((p.fields as string[]) ?? ['email']);
    if (g.kind === 'share_link') setUrl((p.url as string) ?? '');
    if (g.kind === 'custom') setCustomInstructions((p.instructions as string) ?? '');
    setDialogOpen(true);
  };

  const buildParams = (): Record<string, unknown> => {
    if (kind === 'capture_lead') return { fields };
    if (kind === 'share_link') return { url: url.trim() || undefined };
    if (kind === 'custom') return { instructions: customInstructions.trim() || undefined };
    return {};
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Goal name is required');
      return;
    }
    if (kind === 'share_link' && url.trim()) {
      try {
        const u = new URL(url.trim());
        if (!['http:', 'https:'].includes(u.protocol)) {
          toast.error('URL must be http or https');
          return;
        }
      } catch {
        toast.error('Invalid URL');
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        kind,
        description: description.trim() || null,
        params: buildParams(),
      };
      const res = editing
        ? await fetch(`/api/ai/goals/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/ai/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save goal');
        return;
      }
      toast.success(editing ? 'Goal updated' : 'Goal created');
      setDialogOpen(false);
      await fetchGoals();
    } catch {
      toast.error('Failed to save goal');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this goal?')) return;
    try {
      const res = await fetch(`/api/ai/goals/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to delete');
        return;
      }
      toast.success('Goal deleted');
      await fetchGoals();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const toggleEnabled = async (g: Goal) => {
    try {
      const res = await fetch(`/api/ai/goals/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !g.enabled }),
      });
      if (!res.ok) throw new Error();
      await fetchGoals();
    } catch {
      toast.error('Failed to update');
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const newIdx = index + dir;
    if (newIdx < 0 || newIdx >= goals.length) return;
    const reordered = [...goals];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIdx, 0, moved);
    // Optimistic
    setGoals(reordered);
    // Persist priorities sequentially
    try {
      await Promise.all(
        reordered.map((g, i) => fetch(`/api/ai/goals/${g.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: i }) })),
      );
      await fetchGoals();
    } catch {
      toast.error('Failed to reorder');
      await fetchGoals();
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading goals…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" /> Goals
            </CardTitle>
            <CardDescription>What should the agent try to achieve? Goals are configuration only in Phase 2 — the runtime will use them next phase.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" /> Add goal
          </Button>
        </CardHeader>
        <CardContent>
          {goals.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Target className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">No goals yet</h3>
              <p className="mt-1 max-w-[36ch] text-sm text-muted-foreground">Give your agent an outcome to work toward — capture a lead, share a link, or define a custom objective.</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openCreate('capture_lead')}>
                  <Users className="mr-2 h-4 w-4" /> Capture lead
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('share_link')}>
                  <LinkIcon className="mr-2 h-4 w-4" /> Share link
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {goals.map((g, idx) => {
                const Icon = KIND_ICON[g.kind];
                return (
                  <li key={g.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <GripVertical className="h-3 w-3 rotate-90" />
                      </button>
                      <button onClick={() => move(idx, 1)} disabled={idx === goals.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <GripVertical className="h-3 w-3 -rotate-90" />
                      </button>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {g.name}
                        <Badge variant="secondary" className="text-xs">
                          {KIND_LABEL[g.kind]}
                        </Badge>
                        {!g.enabled && <Badge variant="outline">Disabled</Badge>}
                      </p>
                      {g.description && <p className="truncate text-xs text-muted-foreground">{g.description}</p>}
                      <p className="text-xs text-muted-foreground">Priority {g.priority} • {g.enabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                    <Switch checked={g.enabled} onCheckedChange={() => toggleEnabled(g)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(g)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(g.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit goal' : 'Create goal'}</DialogTitle>
            <DialogDescription>What should the agent try to accomplish? Choose a type, then configure the details.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="goal-kind">Goal type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as GoalKind)}>
                <SelectTrigger id="goal-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="capture_lead">Capture lead — collect contact info</SelectItem>
                  <SelectItem value="share_link">Share link — guide to a URL</SelectItem>
                  <SelectItem value="custom">Custom — natural-language objective</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-name">Name</Label>
              <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Capture lead email" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-desc">Description (optional)</Label>
              <Textarea id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Short note for your team" />
            </div>

            {kind === 'capture_lead' && (
              <div className="space-y-2">
                <Label>Fields to collect</Label>
                <div className="flex gap-2">
                  {(['email', 'phone', 'name'] as const).map((f) => (
                    <label key={f} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={fields.includes(f)}
                        onChange={(e) => setFields((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))}
                        className="rounded"
                      />
                      {f}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">The runtime will ask for these fields when the goal is active (Phase 3).</p>
              </div>
            )}

            {kind === 'share_link' && (
              <div className="space-y-2">
                <Label htmlFor="goal-url">Link URL</Label>
                <Input id="goal-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/pricing" />
              </div>
            )}

            {kind === 'custom' && (
              <div className="space-y-2">
                <Label htmlFor="goal-custom">Objective</Label>
                <Textarea id="goal-custom" value={customInstructions} onChange={(e) => setCustomInstructions(e.target.value)} rows={3} placeholder="Qualify the lead by asking about budget and timeline." />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
