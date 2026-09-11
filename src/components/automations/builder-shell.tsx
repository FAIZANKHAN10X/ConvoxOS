'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft,
  Eye,
  History,
  Loader2,
  MoreHorizontal,
  Redo2,
  Undo2,
} from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import { validateDraftGraph } from '@/lib/automation/client-validate';
import type { Automation, AutomationGraph } from '@/lib/automation/types';
import { Button } from '@/components/ui/button';
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

export function BuilderShell({ initial, catalog }: BuilderShellProps) {
  const canEdit = useCan('send-messages');
  const [automation, setAutomation] = useState(initial);
  const [graph, setGraph] = useState<AutomationGraph>(initial.draftGraph);
  const [name, setName] = useState(initial.name);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>(
    'saved'
  );
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Link
          href="/automations"
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Automations
        </Link>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 max-w-xs border-transparent text-[15px] font-semibold text-slate-800 shadow-none hover:border-slate-200 focus-visible:border-slate-300"
          disabled={!canEdit}
        />
        <span className="text-xs text-slate-400">
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
            className="text-slate-500"
            onClick={applyUndo}
            disabled={!canEdit}
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-500"
            onClick={applyRedo}
            disabled={!canEdit}
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          {canEdit && automation.status !== 'draft' && (
            <Button
              variant="outline"
              size="sm"
              className="border-slate-200"
              onClick={() => void toggleDisabled()}
            >
              {automation.status === 'disabled' ? 'Turn on' : 'Turn off'}
            </Button>
          )}
          {automation.status === 'published' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {automation.status === 'published' &&
            liveSnapshot !== null &&
            liveSnapshot !== JSON.stringify(graph) && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                Unpublished changes
              </span>
            )}
          <Button
            variant="outline"
            size="sm"
            className="border-slate-200 bg-white text-slate-700"
            onClick={() =>
              setView(view === 'preview' ? 'builder' : 'preview')
            }
            aria-label="Preview"
          >
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          <Button
            size="sm"
            className="bg-[#2f6fed] px-4 text-white hover:bg-[#2559c4]"
            onClick={() => void publish()}
            disabled={!canEdit || publishing}
          >
            {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
            {automation.status === 'published' ? 'Update' : 'Set Live'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-white text-slate-800"
            >
              <DropdownMenuItem onClick={() => setView('history')}>
                <History className="h-4 w-4" />
                Run history
              </DropdownMenuItem>
              {(view === 'history' || view === 'preview') && (
                <DropdownMenuItem onClick={() => setView('builder')}>
                  Back to builder
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {publishError && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">
          {publishError}
        </p>
      )}
      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto bg-[#f7f9fc]">
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
          <div className="flex flex-1 items-center justify-center bg-[#e8edf3] p-6 lg:hidden">
            <p className="max-w-sm text-center text-sm text-slate-500">
              The visual builder is desktop-only. Open this automation on a
              larger screen to edit the canvas. Run history is available from
              the menu.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
