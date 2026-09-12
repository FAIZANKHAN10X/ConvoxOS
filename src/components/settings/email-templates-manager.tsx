'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string | null;
}

/**
 * Email template manager, rendered under Settings → Templates
 * below the WhatsApp manager. CRUD over /api/email/templates;
 * bodies accept {{contact.name}}-style run-scope variables.
 */
export function EmailTemplatesManager() {
  const t = useTranslations('Settings.emailTemplates');
  const { accountId, canEditSettings } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/email/templates?limit=200');
      if (res.ok) {
        const data = (await res.json()) as { templates: EmailTemplate[] };
        setTemplates(data.templates);
      }
    } catch {
      // Leave stale list on failure.
    }
  }

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/email/templates?limit=200');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { templates: EmailTemplate[] };
        if (!cancelled) setTemplates(data.templates);
      } catch {
        // Leave stale list on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function startEdit(tpl: EmailTemplate) {
    setEditingId(tpl.id);
    setName(tpl.name);
    setSubject(tpl.subject);
    setBody(tpl.body_text);
  }

  function reset() {
    setEditingId(null);
    setName('');
    setSubject('');
    setBody('');
  }

  async function save() {
    if (!name.trim() || !subject.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/email/templates/${editingId}` : '/api/email/templates',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            subject: subject.trim(),
            body_text: body,
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      reset();
      await refresh();
    } catch {
      // Keep the form open on failure for retry.
    }
    setSaving(false);
  }

  async function remove(id: string) {
    await fetch(`/api/email/templates/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle className="text-sm">{t('title')}</CardTitle>
        <CardDescription className="text-xs">{t.raw('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
          >
            <div>
              <p className="text-sm font-medium">{tpl.name}</p>
              <p className="text-xs text-muted-foreground">{tpl.subject}</p>
            </div>
            {canEditSettings && (
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => startEdit(tpl)}>
                  {t('edit')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => remove(tpl.id)}>
                  {t('delete')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {canEditSettings && (
          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="space-y-1">
              <Label htmlFor="email-tpl-name" className="text-xs">
                {t('nameLabel')}
              </Label>
              <Input
                id="email-tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-tpl-subject" className="text-xs">
                {t('subjectLabel')}
              </Label>
              <Input
                id="email-tpl-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-tpl-body" className="text-xs">
                {t('bodyLabel')}
              </Label>
              <textarea
                id="email-tpl-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={save}
                disabled={saving || !name.trim() || !subject.trim() || !body.trim()}
              >
                {editingId ? t('save') : t('create')}
              </Button>
              {editingId && (
                <Button variant="outline" size="sm" onClick={reset}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
