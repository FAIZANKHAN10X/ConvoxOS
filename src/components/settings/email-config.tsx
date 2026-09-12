'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Loader2, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface EmailStatus {
  connected: boolean;
  config?: {
    id: string;
    from_address: string;
    from_name: string | null;
    connected_at: string | null;
  } | null;
}

export function EmailConfig({
  onConnected,
  onDisconnected,
}: {
  onConnected: () => void;
  onDisconnected: () => void;
}) {
  const t = useTranslations('Settings.email');
  const { accountId, loading: authLoading, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<EmailStatus>({ connected: false });
  const [apiKey, setApiKey] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [webhook, setWebhook] = useState<{ url: string; secret: string } | null>(null);
  const loadedRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/config', { cache: 'no-store' });
      const payload = (await res.json()) as EmailStatus;
      setStatus(payload);
      if (payload.config) {
        setFromAddress(payload.config.from_address);
        setFromName(payload.config.from_name ?? '');
      }
    } catch {
      // Keep disconnected state on failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !accountId) return;
    if (loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    void fetchStatus();
  }, [authLoading, accountId, fetchStatus]);

  async function handleConnect() {
    if (!apiKey.trim() || !fromAddress.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey.trim(),
          from_address: fromAddress.trim(),
          from_name: fromName.trim() || undefined,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        webhookSecret?: string;
        webhookUrl?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? t('saveFailed'));
      setWebhook({ url: payload.webhookUrl ?? '', secret: payload.webhookSecret ?? '' });
      setApiKey('');
      await fetchStatus();
      onConnected();
      toast.success(t('connectedSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    }
    setSaving(false);
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/email/config', { method: 'DELETE' });
      if (!res.ok) throw new Error(t('disconnectFailed'));
      setStatus({ connected: false });
      setWebhook(null);
      onDisconnected();
      toast.success(t('disconnectedSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('disconnectFailed'));
    }
    setDisconnecting(false);
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  }

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">
        <Loader2 className="mr-1 inline size-3 animate-spin" />
        {t('loading')}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('title')}</CardTitle>
        <CardDescription className="text-xs">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.connected ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 className="size-3.5" />
            {t('connectedHint')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('notConnectedHint')}</p>
        )}
        {canEditSettings && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="email-api-key" className="text-xs">
                {t('apiKeyLabel')}
              </Label>
              <Input
                id="email-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="re_…"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="email-from" className="text-xs">
                  {t('fromLabel')}
                </Label>
                <Input
                  id="email-from"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="sales@acme.test"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email-from-name" className="text-xs">
                  {t('fromNameLabel')}
                </Label>
                <Input
                  id="email-from-name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Acme"
                />
              </div>
            </div>
            <Button size="sm" onClick={handleConnect} disabled={saving}>
              {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
              {status.connected ? t('reconnect') : t('connect')}
            </Button>
          </div>
        )}
        {webhook && webhook.url && (
          <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
            <p className="font-medium">{t('webhookTitle')}</p>
            <p className="break-all">{webhook.url}</p>
            <div className="flex items-center gap-1">
              <code className="break-all">{webhook.secret}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(`${webhook.url}\n${webhook.secret}`)}
                aria-label={t('copied')}
              >
                <Copy className="size-3" />
              </Button>
            </div>
            <p className="text-muted-foreground">{t('webhookHint')}</p>
          </div>
        )}
        {status.connected && canEditSettings && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-red-600"
          >
            <Trash2 className="mr-1 size-3" />
            {t('disconnect')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
