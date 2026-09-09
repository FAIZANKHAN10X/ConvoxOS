'use client';

import { Smartphone, X } from 'lucide-react';

import type { CatalogNode } from '@/lib/automation/catalog';
import type { AutomationGraph } from '@/lib/automation/types';

/**
 * Message-only preview: renders the automation's send-text steps as a
 * phone mock, in canvas top-to-bottom order. Branching, conditions,
 * waits, and CRM actions are not simulated — the panel says so.
 * No preview backend exists; this is the honest UI entry point.
 */
export function PreviewPanel({
  graph,
  catalog,
  onClose,
}: {
  graph: AutomationGraph;
  catalog: CatalogNode[];
  onClose: () => void;
}) {
  const byType = new Map(catalog.map((node) => [node.type, node]));
  const messages = graph.nodes
    .filter((node) => byType.get(node.type)?.preview === 'message')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .map((node) => {
      const text = node.data?.config?.text;
      return {
        id: node.id,
        label: byType.get(node.type)?.label ?? node.type,
        text: typeof text === 'string' && text.trim() ? text.trim() : null,
      };
    });

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[min(100%,380px)] flex-col border-l border-slate-200 bg-white shadow-[-12px_0_32px_rgba(31,41,55,0.08)]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Smartphone className="h-4 w-4 text-slate-500" />
        <p className="flex-1 text-[15px] font-semibold text-slate-800">
          Preview
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close preview"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto bg-[#f7f9fc] px-5 py-4">
        <div className="mx-auto max-w-[300px] rounded-[28px] border border-slate-200 bg-slate-900 p-2 shadow-lg">
          <div className="flex min-h-[320px] flex-col gap-2 rounded-[20px] bg-white px-3 py-4">
            {messages.length === 0 && (
              <p className="mt-8 text-center text-xs text-slate-400">
                No messages yet. Add a Send text step to see it here.
              </p>
            )}
            {messages.map((message) => (
              <div key={message.id}>
                <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2">
                  <p className="text-[13px] leading-snug text-slate-700">
                    {message.text ?? (
                      <span className="text-slate-400 italic">
                        {message.label} — not written yet
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-[300px] text-center text-[11px] leading-snug text-slate-400">
          Message content only. Conditions, waits, branches, and CRM actions
          are not simulated — publish and test with a real contact.
        </p>
      </div>
    </div>
  );
}
