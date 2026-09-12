'use client';

import { useState } from 'react';

import type { FormField } from '@/lib/forms/write';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface LeadForm {
  id: string;
  name: string;
  fields: FormField[];
  is_active: boolean;
  created_at: string;
}

interface Submission {
  id: string;
  values: Record<string, string>;
  attribution: Record<string, string>;
  created_at: string;
  contact: { id: string; name: string | null; phone: string; email: string | null } | null;
}

const FIELD_TYPES = ['name', 'phone', 'email', 'company', 'message'] as const;

function FieldEditor({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}) {
  function update(index: number, patch: Partial<FormField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }
  function add() {
    const used = new Set(fields.map((f) => f.key));
    const type = FIELD_TYPES.find((t) => t !== 'phone' && !used.has(t));
    if (!type) return;
    onChange([
      ...fields,
      { key: type, label: type[0].toUpperCase() + type.slice(1), type, required: false },
    ]);
  }
  return (
    <div className="space-y-2">
      {fields.map((field, i) => (
        <div key={field.key} className="flex items-center gap-2">
          <Input
            value={field.label}
            onChange={(e) => update(i, { label: e.target.value })}
            disabled={field.type === 'phone'}
            className="h-8"
            aria-label="Field label"
          />
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{field.type}</span>
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={field.required}
              disabled={field.type === 'phone'}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            Req
          </label>
          {field.type !== 'phone' && (
            <Button variant="ghost" size="sm" onClick={() => remove(i)}>
              ✕
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        Add field
      </Button>
      <p className="text-xs text-muted-foreground">
        Phone is always present and required — leads are phone-keyed.
      </p>
    </div>
  );
}

export function FormsClient({ initialForms }: { initialForms: LeadForm[] }) {
  const [forms, setForms] = useState(initialForms);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LeadForm | null>(null);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [subsForm, setSubsForm] = useState<LeadForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/forms');
    if (res.ok) {
      const data = (await res.json()) as { forms: LeadForm[] };
      setForms(data.forms);
    }
  }

  function openCreate() {
    setEditing(null);
    setName('');
    setFields([
      { key: 'phone', label: 'Phone', type: 'phone', required: true },
      { key: 'name', label: 'Name', type: 'name', required: true },
    ]);
    setNewToken(null);
    setEditorOpen(true);
  }

  function openEdit(form: LeadForm) {
    setEditing(form);
    setName(form.name);
    setFields(form.fields);
    setNewToken(null);
    setEditorOpen(true);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/forms/${editing.id}` : '/api/forms',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), fields }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { token?: string };
      if (data.token) setNewToken(data.token);
      else {
        setEditorOpen(false);
        await refresh();
      }
      if (data.token) await refresh();
    } catch {
      // Keep the dialog open on failure for retry.
    }
    setSaving(false);
  }

  async function toggleActive(form: LeadForm) {
    await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !form.is_active }),
    });
    await refresh();
  }

  async function viewSubmissions(form: LeadForm) {
    setSubsForm(form);
    const res = await fetch(`/api/forms/${form.id}/submissions?limit=50`);
    if (res.ok) {
      const data = (await res.json()) as { submissions: Submission[] };
      setSubmissions(data.submissions);
    }
  }

  function publicUrl(): string | null {
    if (!newToken || typeof window === 'undefined') return null;
    return `${window.location.origin}/f/${newToken}`;
  }

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Lead forms</h1>
        <Button size="sm" onClick={openCreate}>
          New form
        </Button>
      </div>
      {forms.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No forms yet. Create one to start capturing leads.
        </p>
      )}
      <div className="grid gap-3">
        {forms.map((form) => (
          <div key={form.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{form.name}</p>
                <p className="text-xs text-muted-foreground">
                  {form.fields.length} fields · {form.is_active ? 'Active' : 'Paused'}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => viewSubmissions(form)}>
                  Submissions
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(form)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleActive(form)}
                >
                  {form.is_active ? 'Pause' : 'Activate'}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit form' : 'New form'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Changes apply to future submissions.'
                : 'The public link is shown once after creation.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Form name"
              aria-label="Form name"
            />
            <FieldEditor fields={fields} onChange={setFields} />
            {newToken && publicUrl() && (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                <p className="font-medium">Public link (save it — shown once):</p>
                <p className="break-all">{publicUrl()}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => copy(publicUrl()!, 'token')}
                >
                  {copied === 'token' ? 'Copied' : 'Copy link'}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              {newToken ? 'Done' : 'Cancel'}
            </Button>
            {!newToken && (
              <Button onClick={save} disabled={saving || !name.trim()}>
                {editing ? 'Save' : 'Create'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!subsForm} onOpenChange={(open) => !open && setSubsForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Submissions — {subsForm?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto py-2">
            {submissions.length === 0 && (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            )}
            {submissions.map((s) => (
              <div key={s.id} className="rounded-md border border-border p-2 text-xs">
                <p className="font-medium">
                  {s.contact?.name ?? s.values.name ?? s.contact?.phone ?? 'Unknown'}
                  {s.contact?.phone && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {s.contact.phone}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {Object.entries(s.values)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
                <p className="text-muted-foreground">
                  {new Date(s.created_at).toLocaleString()}
                  {s.attribution?.utm_source && ` · via ${s.attribution.utm_source}`}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
