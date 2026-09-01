'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, RefreshCw, BookOpen, Link as LinkIcon, FileText, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTranslations } from 'next-intl';

interface DocSummary {
  id: string;
  title: string;
  source_type: 'text' | 'url' | 'file';
  source_url: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  char_count: number;
  chunk_count: number;
  updated_at: string;
  created_at: string;
}

type EditTarget = 'new' | string | null;
type SourceTab = 'text' | 'url' | 'file';

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiKnowledge');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const openNew = () => {
    setEditing('new');
    setTitle('');
    setContent('');
    setUrlInput('');
    setFile(null);
    setSourceTab('text');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('openFailed'));
        return;
      }
      setEditing(id);
      setTitle(data.title ?? '');
      setContent(data.content ?? '');
      setSourceTab('text');
    } catch {
      toast.error(t('openFailed'));
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setUrlInput('');
    setFile(null);
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error(t('titleContentRequired'));
      return;
    }
    // Validate per source
    if (sourceTab === 'text' && !content.trim()) {
      toast.error(t('titleContentRequired'));
      return;
    }
    if (sourceTab === 'url' && !urlInput.trim()) {
      toast.error('URL is required');
      return;
    }
    if (sourceTab === 'file' && !file) {
      toast.error('File is required');
      return;
    }
    if (content.length > 250000 || (file && file.size > 8 * 1024 * 1024)) {
      toast.error('Content too large');
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      let res: Response;
      if (sourceTab === 'file' && file) {
        const form = new FormData();
        form.append('title', title.trim());
        form.append('file', file);
        res = await fetch(isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`, {
          method: isNew ? 'POST' : 'PATCH',
          body: form,
        });
      } else if (sourceTab === 'url') {
        res = await fetch(isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`, {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            source_type: 'url',
            source_url: urlInput.trim(),
            content: content.trim() || undefined,
          }),
        });
      } else {
        res = await fetch(isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`, {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim(), source_type: 'text' }),
        });
      }
      const data = await res.json();
      if (res.ok) {
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? t('saveSuccessNew') : t('saveSuccessUpdate'));
        cancelEdit();
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(t('reindexSuccess', { count: data.reindexed }));
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('reindexFailed'));
      }
    } catch {
      toast.error(t('reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case 'ready':
        return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">Ready</Badge>;
      case 'processing':
      case 'pending':
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{s}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description', { searchType: hasEmbeddingsKey ? t('semanticSearchOn') : t('keywordSearchOn') })} • Max 250,000 chars per source
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {docs.length === 0 && editing === null && (
              <div className="flex flex-col items-center rounded-lg border border-dashed border-border p-6 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium text-foreground">No knowledge yet</p>
                <p className="mt-1 max-w-[36ch] text-xs text-muted-foreground">Add your FAQs, policies, or product docs. The agent answers only from what you teach it.</p>
              </div>
            )}

            {docs.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        {doc.source_type === 'url' ? <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" /> : doc.source_type === 'file' ? <FileText className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                        <span className="truncate">{doc.title}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="capitalize">{doc.source_type}</span>
                        <span>•</span>
                        <span>{doc.char_count.toLocaleString()} chars</span>
                        <span>•</span>
                        <span>{doc.chunk_count} chunks</span>
                        <span>•</span>
                        {statusBadge(doc.status)}
                        {doc.source_url && <span className="truncate">• {doc.source_url}</span>}
                      </p>
                    </div>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => void openEdit(doc.id)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => void remove(doc.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as SourceTab)}>
                  <TabsList className="w-full justify-start">
                    <TabsTrigger value="text">Write / Paste</TabsTrigger>
                    <TabsTrigger value="url">URL</TabsTrigger>
                    <TabsTrigger value="file">File</TabsTrigger>
                  </TabsList>
                  <TabsContent value="text" className="mt-3 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="kb-title">Title</Label>
                      <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('editDocTitlePlaceholder')} disabled={saving} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kb-content">Content</Label>
                      <Textarea id="kb-content" value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('editDocContentPlaceholder')} rows={8} disabled={saving} />
                      <p className="text-xs text-muted-foreground">{content.length.toLocaleString()} / 250,000 chars • {Math.ceil(content.length / 1200)} chunks est.</p>
                    </div>
                  </TabsContent>
                  <TabsContent value="url" className="mt-3 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="kb-title-url">Title</Label>
                      <Input id="kb-title-url" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pricing page" disabled={saving} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kb-url">URL</Label>
                      <Input id="kb-url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://example.com/pricing" disabled={saving} />
                      <p className="text-xs text-muted-foreground">We fetch the page server-side, strip HTML, and index the readable text. Private networks blocked, 1.2MB max, 8s timeout.</p>
                    </div>
                  </TabsContent>
                  <TabsContent value="file" className="mt-3 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="kb-title-file">Title</Label>
                      <Input id="kb-title-file" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Handbook" disabled={saving} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kb-file">File (PDF, DOCX, TXT, MD, CSV — max 8MB)</Label>
                      <Input id="kb-file" type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={saving} />
                      {file && <p className="text-xs text-muted-foreground">{file.name} • {(file.size / 1024).toFixed(1)} KB</p>}
                    </div>
                  </TabsContent>
                </Tabs>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('saveDoc')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={openNew}>
                    <Plus className="mr-2 h-4 w-4" /> {t('addDoc')}
                  </Button>
                  {hasEmbeddingsKey && docs.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={reindex} disabled={reindexing} title={t('reindexTooltip')}>
                      {reindexing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      {t('reindex')}
                    </Button>
                  )}
                </div>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
