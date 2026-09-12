'use client';

import { useState } from 'react';

import type { FormField } from '@/lib/forms/write';

interface PublicFormProps {
  token: string;
  fields: FormField[];
  attribution: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  };
}

export function PublicForm({ token, fields, attribution }: PublicFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/forms/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values,
          attribution: {
            ...attribution,
            referrer:
              typeof document !== 'undefined' ? document.referrer.slice(0, 500) : undefined,
          },
          submission_key:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? 'Submission failed');
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    }
    setSaving(false);
  }

  if (done) {
    return (
      <p className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
        Thanks — we&apos;ll be in touch shortly.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label htmlFor={`field-${field.key}`} className="text-sm font-medium">
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </label>
          {field.type === 'message' ? (
            <textarea
              id={`field-${field.key}`}
              value={values[field.key] ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              required={field.required}
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          ) : (
            <input
              id={`field-${field.key}`}
              type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              required={field.required}
              autoComplete={
                field.type === 'phone'
                  ? 'tel'
                  : field.type === 'email'
                    ? 'email'
                    : field.type === 'name'
                      ? 'name'
                      : 'off'
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          )}
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? 'Sending…' : 'Submit'}
      </button>
    </form>
  );
}
