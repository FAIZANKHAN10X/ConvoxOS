'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft,
  Eye,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Redo2,
  Undo2,
  Users,
} from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { validateDraftGraph } from '@/lib/automation/client-validate';
import type { Automation, AutomationGraph } from '@/lib/automation/types';
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
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';

import { FlowCanvas } from './flow-canvas';
import { HistoryPanel } from './history-panel';
import { PreviewPanel } from './preview-panel';

interface BuilderShellProps {
  initial: Automation;
  catalog: CatalogNode[];
}

const APP_JUMPS = [
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
] as const;

export function BuilderShell({ initial, catalog }: BuilderShellProps) {
  const router = useRouter();
  const canEdit = useCan('send-messages');
  const [automation, setAutomation] = useState(initial);
  const [graph, setGraph] = useState<AutomationGraph>(initial.draftGraph);
  const [name, setName] = useState(initial.name);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>(
    'saved'
  );
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [reentryPolicy, setReentryPolicy] = useState<'once' | 'repeat'>(
    initial.reentryPolicy ?? 'repeat'
  );
  const [stopOnReply, setStopOnReply] = useState(initial.stopOnReply ?? false);
  const [savingEnrollment, setSavingEnrollment] = useState(false);
  const [view, setView] = useState<'builder' | 'history' | 'preview'>(
    'builder'
  );

  const undo = useRef<AutomationGraph[]>([]);
  const redo = useRef<AutomationGraph[]>([]);
  const skipSave = useRef(true);
  const graphRef = useRef(graph);
  const nameRef = useRef(name);
  const persistRef = useRef<
    (nextName: string, nextGraph: AutomationGraph) => Promise<void>
  >(async () => undefined);
  const [liveSnapshot, setLiveSnapshot] = useState<string | null>(
    initial.status === 'published'
      ? JSON.stringify(initial.draftGraph)
      : null
  );
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const persist = useCallback(
    async (nextName: string, nextGraph: AutomationGraph) => {
      setSaveState('saving');
      const response = await fetch(`/api/automations/${automation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName, graph: nextGraph }),
      });
      if (!response.ok) {
        setSaveState('error');
        return;
      }
      const body = await response.json();
      setAutomation(body.automation);
      setSaveState('saved');
    },
    [automation.id]
  );

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  useEffect(() => {
    return () => {
      void persistRef.current(nameRef.current, graphRef.current);
    };
  }, []);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void persist(name, graph);
    }, 800);
    return () => window.clearTimeout(handle);
  }, [graph, name, persist]);

  const applyUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(graph);
    setGraph(prev);
  }, [graph]);

  const applyRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(graph);
    setGraph(next);
  }, [graph]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) applyRedo();
      else applyUndo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyRedo, applyUndo]);

  const changeGraph = useCallback((next: AutomationGraph) => {
    undo.current.push(graphRef.current);
    redo.current = [];
    setGraph(next);
    setPublishError(null);
  }, []);

  async function publish() {
    const issues = validateDraftGraph(graph, catalog);
    if (issues.length > 0) {
      setPublishError(issues[0].message);
      return;
    }
    setPublishing(true);
    setPublishError(null);
    await persist(name, graph);
    const response = await fetch(`/api/automations/${automation.id}/publish`, {
      method: 'POST',
    });
    const body = await response.json();
    setPublishing(false);
    if (!response.ok) {
      const first = Array.isArray(body.issues)
        ? body.issues[0]?.message
        : body.error;
      setPublishError(first ?? 'Publish failed');
      return;
    }
    setAutomation(body.automation);
    setLiveSnapshot(JSON.stringify(graph));
  }

  async function toggleDisabled() {
    const path =
      automation.status === 'disabled'
        ? `/api/automations/${automation.id}/enable`
        : `/api/automations/${automation.id}/disable`;
    const response = await fetch(path, { method: 'POST' });
    const body = await response.json();
    if (response.ok) setAutomation(body.automation);
    else setPublishError(body.error ?? 'Could not update status');
  }

  async function saveEnrollment() {
    setSavingEnrollment(true);
    const response = await fetch(`/api/automations/${automation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reentryPolicy, stopOnReply }),
    });
    setSavingEnrollment(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setPublishError(
        (body as { error?: string }).error ?? 'Could not save enrollment settings'
      );
      return;
    }
    const body = await response.json();
    setAutomation(body.automation);
    setEnrollmentOpen(false);
  }

  async function remove() {
    setDeleting(true);
    const response = await fetch(`/api/automations/${automation.id}`, {
      method: 'DELETE',
    });
    setDeleting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setPublishError(
        (body as { error?: string }).error ?? 'Could not delete automation'
      );
      setDeleteOpen(false);
      return;
    }
    router.push('/automations');
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-card px-3 py-2 text-foreground">
        <Link
          href="/automations"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Automations
        </Link>
        <nav
          aria-label="App"
          className="flex items-center gap-0.5 border-l border-border/60 pl-2"
        >
          {APP_JUMPS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 max-w-xs border-transparent text-sm font-semibold text-foreground shadow-none hover:border-border/70 focus-visible:border-primary"
          disabled={!canEdit}
        />
        <span className="text-xs text-muted-foreground">
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'error'
              ? 'Save failed'
              : 'Saved'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={applyUndo}
            disabled={!canEdit}
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={applyRedo}
            disabled={!canEdit}
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          {canEdit && automation.status !== 'draft' && (
            <Button
              variant="outline"
              size="sm"
              className="border-border/70 text-xs"
              onClick={() => void toggleDisabled()}
            >
              {automation.status === 'disabled' ? 'Turn on' : 'Turn off'}
            </Button>
          )}
          {automation.status === 'published' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {automation.status === 'published' &&
            liveSnapshot !== null &&
            liveSnapshot !== JSON.stringify(graph) && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-500">
                Unpublished changes
              </span>
            )}
          {(view === 'history' || view === 'preview') && (
            <Button
              variant="outline"
              size="sm"
              className="border-border/70 text-xs"
              onClick={() => setView('builder')}
            >
              Back to canvas
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-border/70 bg-card text-xs text-foreground hover:bg-muted/60"
            onClick={() =>
              setView(view === 'history' ? 'builder' : 'history')
            }
            aria-label="Run history"
          >
            <History className="h-3.5 w-3.5" />
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-border/70 bg-card text-xs text-foreground hover:bg-muted/60"
            onClick={() =>
              setView(view === 'preview' ? 'builder' : 'preview')
            }
            aria-label="Preview"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            size="sm"
            className="bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 shadow-xs font-medium"
            onClick={() => void publish()}
            disabled={!canEdit || publishing}
          >
            {publishing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {automation.status === 'published' ? 'Update' : 'Set Live'}
          </Button>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-popover border-border/70 text-popover-foreground"
              >
                <DropdownMenuItem
                  onClick={() => {
                    setReentryPolicy(automation.reentryPolicy ?? 'repeat');
                    setStopOnReply(automation.stopOnReply ?? false);
                    setEnrollmentOpen(true);
                  }}
                >
                  Enrollment settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteOpen(true)}
                  className="text-red-600"
                >
                  Delete automation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      {publishError && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">
          {publishError}
        </p>
      )}
      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto bg-background">
          <HistoryPanel automationId={automation.id} />
        </div>
      ) : (
        <>
          <div className="relative hidden min-h-0 flex-1 lg:block">
            <ReactFlowProvider>
              <FlowCanvas
                graph={graph}
                catalog={catalog}
                readOnly={!canEdit}
                automationId={automation.id}
                onChange={changeGraph}
              />
            </ReactFlowProvider>
            {view === 'preview' && (
              <PreviewPanel
                graph={graph}
                catalog={catalog}
                onClose={() => setView('builder')}
              />
            )}
          </div>
          <div className="flex flex-1 items-center justify-center bg-muted/40 p-6 lg:hidden">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              The visual builder is desktop-only. Open this automation on a
              larger screen to edit the canvas. Run history is available from
              History in the header.
            </p>
          </div>
        </>
      )}
      <Dialog open={enrollmentOpen} onOpenChange={setEnrollmentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enrollment settings</DialogTitle>
            <DialogDescription>
              Control how contacts enter this automation and when
              running contacts stop.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label
                htmlFor="reentry-policy"
                className="text-sm font-medium text-foreground"
              >
                Re-entry
              </label>
              <select
                id="reentry-policy"
                value={reentryPolicy}
                onChange={(event) =>
                  setReentryPolicy(
                    event.target.value === 'once' ? 'once' : 'repeat'
                  )
                }
                disabled={!canEdit || savingEnrollment}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                <option value="repeat">
                  Every time (while not already running)
                </option>
                <option value="once">Only once per contact</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {reentryPolicy === 'once'
                  ? 'A contact enrolls at most once ever — later triggers are skipped.'
                  : 'A contact re-enrolls on every matching trigger once no run is active.'}
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={stopOnReply}
                onChange={(event) => setStopOnReply(event.target.checked)}
                disabled={!canEdit || savingEnrollment}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Stop on reply
                </span>
                <span className="block text-xs text-muted-foreground">
                  An inbound message cancels this contact&apos;s running
                  executions before anything new enrolls.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEnrollmentOpen(false)}
              disabled={savingEnrollment}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveEnrollment()}
              disabled={!canEdit || savingEnrollment}
            >
              {savingEnrollment && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this automation?</DialogTitle>
            <DialogDescription>
              This permanently removes the automation, its versions, and run
              history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
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
