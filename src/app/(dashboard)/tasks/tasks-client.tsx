"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useTranslations } from 'next-intl';

interface TaskListRow {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'completed';
  due_at: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  deal_id: string | null;
  created_at: string;
  contact?: { id: string; name: string | null; phone: string | null } | null;
  deal?: { id: string; title: string } | null;
}

interface Member {
  user_id: string;
  full_name: string;
  email: string | null;
}

interface PickerContact {
  id: string;
  name: string | null;
  phone: string | null;
}

interface PickerDeal {
  id: string;
  title: string;
}

function isOverdue(t: TaskListRow, now: number): boolean {
  return t.status === 'open' && !!t.due_at && new Date(t.due_at).getTime() < now;
}

export default function TasksClient({ initialTasks = [] }: { initialTasks?: TaskListRow[] }) {
  const t = useTranslations('Tasks.page');
  const supabase = createClient();
  const [tasks, setTasks] = useState<TaskListRow[]>(initialTasks);
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const [loading, setLoading] = useState(initialTasks.length === 0);
  const [now] = useState(() => Date.now());

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactId, setContactId] = useState('');
  const [dealId, setDealId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<TaskListRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [deals, setDeals] = useState<PickerDeal[]>([]);

  const load = useCallback(async () => {
    let query = supabase
      .from('tasks')
      .select('id, title, description, status, due_at, contact_id, assigned_to, deal_id, created_at, contact:contacts(id, name, phone), deal:deals(id, title)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') query = query.eq('status', filter);
    const { data } = await query;
    setTasks(((data ?? []) as unknown as TaskListRow[]));
    setLoading(false);
  }, [supabase, filter]);

  useEffect(() => {
    // Skip the first fetch when the server already supplied open rows
    // and the filter is still the default.
    if (initialTasks.length > 0 && filter === 'open') {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    (async () => {
      const [m, c, d] = await Promise.all([
        fetch('/api/account/members', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))),
        supabase.from('contacts').select('id, name, phone').order('name').limit(200),
        supabase.from('deals').select('id, title').eq('status', 'open').order('created_at', { ascending: false }).limit(200),
      ]);
      setMembers((m as { members?: Member[] }).members ?? []);
      setContacts(((c.data ?? []) as unknown as PickerContact[]));
      setDeals(((d.data ?? []) as unknown as PickerDeal[]));
    })();
  }, [supabase]);

  const visible = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      // Overdue first, then nearest due, then newest.
      const ao = isOverdue(a, now) ? 0 : 1;
      const bo = isOverdue(b, now) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return b.created_at.localeCompare(a.created_at);
    });
    return sorted;
  }, [tasks, now]);

  async function handleCreate() {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          contact_id: contactId || null,
          deal_id: dealId || null,
          assigned_to: assignee || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle('');
      setDescription('');
      setContactId('');
      setDealId('');
      setAssignee('');
      setDueAt('');
      setCreateOpen(false);
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleComplete(id: string) {
    // Optimistic: flip immediately; the route emits task_completed.
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'completed' } : x)));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (!res.ok) throw new Error(await res.text());
      if (detail?.id === id) setDetail(null);
      await load();
    } catch {
      await load();
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    if (detail?.id === id) setDetail(null);
    await load();
  }

  async function handleSaveDetail(patch: Partial<TaskListRow>) {
    if (!detail) return;
    const res = await fetch(`/api/tasks/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { task: TaskListRow };
    setDetail(json.task);
    await load();
  }

  const memberName = (userId: string | null) =>
    members.find((m) => m.user_id === userId)?.full_name || userId || '—';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {t('newTask')}
        </Button>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted/60 p-1 w-fit">
        {(['open', 'completed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${filter === f ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(`filter_${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-border/70 bg-card shadow-xs">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs">
          {visible.map((task) => {
            const overdue = isOverdue(task, now);
            return (
              <div
                key={task.id}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0 hover:bg-muted/40"
              >
                <button
                  type="button"
                  aria-label={t('completeAria')}
                  disabled={task.status === 'completed'}
                  onClick={() => void handleComplete(task.id)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${task.status === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border hover:border-primary'}`}
                >
                  {task.status === 'completed' && (
                    <svg viewBox="0 0 8 8" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M1 4.5 3.2 6.5 7 1.5" />
                    </svg>
                  )}
                </button>
                <button type="button" onClick={() => setDetail(task)} className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-sm font-medium ${task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {task.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[task.contact?.name || task.contact?.phone, task.deal?.title, overdue ? t('overdue') : task.due_at ? new Date(task.due_at).toLocaleDateString() : null, memberName(task.assigned_to) !== '—' ? memberName(task.assigned_to) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </button>
                {overdue && (
                  <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                    {t('overdue')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newTask')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('descPlaceholder')} className="min-h-20" />
            <div className="grid grid-cols-2 gap-2">
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
                <option value="">{t('noContact')}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.phone}</option>
                ))}
              </select>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
                <option value="">{t('noDeal')}</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
                <option value="">{t('unassigned')}</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                ))}
              </select>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleCreate()} disabled={!title.trim() || creating} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent>
          {detail && (
            <DetailSheet
              task={detail}
              members={members}
              onSave={(patch) => void handleSaveDetail(patch)}
              onComplete={() => void handleComplete(detail.id)}
              onDelete={() => void handleDelete(detail.id)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailSheet({
  task,
  members,
  onSave,
  onComplete,
  onDelete,
}: {
  task: TaskListRow;
  members: Member[];
  onSave: (patch: Partial<TaskListRow>) => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('Tasks.page');
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [assignee, setAssignee] = useState(task.assigned_to ?? '');
  const [dueAt, setDueAt] = useState(task.due_at ? task.due_at.slice(0, 16) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-4 p-1">
      <SheetHeader>
        <SheetTitle>{t('details')}</SheetTitle>
      </SheetHeader>
      <div className="space-y-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} />
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('descPlaceholder')} className="min-h-24" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm">
          <option value="">{t('unassigned')}</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
          ))}
        </select>
        <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        {task.contact && (
          <p className="text-xs text-muted-foreground">
            {t('contact')}: <Link href="/contacts" className="text-primary hover:underline">{task.contact.name || task.contact.phone}</Link>
          </p>
        )}
        {task.deal && (
          <p className="text-xs text-muted-foreground">
            {t('deal')}: <Link href="/pipelines" className="text-primary hover:underline">{task.deal.title}</Link>
          </p>
        )}
        <Button
          onClick={() =>
            onSave({
              title: title.trim() || task.title,
              description: description.trim() || null,
              assigned_to: assignee || null,
              due_at: dueAt ? new Date(dueAt).toISOString() : null,
            })
          }
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {t('save')}
        </Button>
        {task.status === 'open' ? (
          <Button variant="outline" onClick={onComplete} className="w-full">
            {t('markComplete')}
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">{t('completedNote')}</p>
        )}
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button variant="destructive" onClick={onDelete} className="flex-1">{t('confirmDelete')}</Button>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} className="flex-1">{t('cancel')}</Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="w-full text-muted-foreground hover:text-destructive">
            {t('delete')}
          </Button>
        )}
      </div>
    </div>
  );
}
