'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2, Copy, Eye, EyeOff, Send, AlertTriangle, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ConfigRow = {
  bot_username: string | null;
  bot_id: number | null;
  status: string | null;
  connected_at: string | null;
};

export function TelegramConfig({
  onConnected,
  onDisconnected,
}: {
  onConnected: () => void;
  onDisconnected: () => void;
}) {
  const t = useTranslations('Settings.telegram');
  const tChannels = useTranslations('Settings.channels');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [config, setConfig] = useState<ConfigRow | null>(null);

  const [botToken, setBotToken] = useState('');
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('telegram_config')
        .select('bot_username, bot_id, status, connected_at')
        .eq('account_id', acctId)
        .maybeSingle();
      if (error) console.error('[telegram] load row failed', error);
      if (data) {
        setConfig(data as ConfigRow);
      } else {
        setConfig(null);
      }
      // Health probe via API for authoritative status (decrypt + getMe)
      try {
        const res = await fetch('/api/telegram/config', { method: 'GET', cache: 'no-store' });
        const payload = await res.json();
        if (payload.connected) {
          setConnectionStatus('connected');
          setStatusMessage('');
          if (payload.webhook_url) setWebhookUrl(payload.webhook_url);
          if (payload.bot_username || payload.bot_id) {
            setConfig((prev) => ({
              bot_username: payload.bot_username ?? prev?.bot_username ?? null,
              bot_id: payload.bot_id ?? prev?.bot_id ?? null,
              status: 'connected',
              connected_at: payload.connected_at ?? prev?.connected_at ?? null,
            }));
          }
        } else {
          setConnectionStatus('disconnected');
          setStatusMessage(payload.message || '');
          if (payload.webhook_url) setWebhookUrl(payload.webhook_url);
          // Fallback webhook URL from window if API didn't return one but row exists
          if (!payload.webhook_url && data) {
            setWebhookUrl(typeof window !== 'undefined' ? `${window.location.origin}/api/telegram/webhook/...` : '');
          }
        }
      } catch {
        // Fallback to row status when API unreachable
        if (data?.status === 'connected') setConnectionStatus('connected');
        else setConnectionStatus('disconnected');
      }
      // Derived webhook URL if still empty and we have an id via another fetch
      if (!webhookUrl && typeof window !== 'undefined' && data) {
        // We don't have id here; fetch id separately if needed
        const { data: withId } = await supabase.from('telegram_config').select('id').eq('account_id', acctId).maybeSingle();
        if (withId?.id) setWebhookUrl(`${window.location.origin}/api/telegram/webhook/${withId.id}`);
      }
    } catch (err) {
      console.error('[telegram] fetchConfig error', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, webhookUrl]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!botToken.trim()) {
      toast.error(t('tokenRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_token: botToken.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        if (data.error) setStatusMessage(data.error);
        setConnectionStatus('disconnected');
        return;
      }
      if (data.success === false && data.webhook_ok === false) {
        toast.error(data.webhook_error ? `${t('connectedWithWebhookWarning')}: ${data.webhook_error}` : t('webhookFailed'), { duration: 8000 });
        setStatusMessage(data.webhook_error || '');
        setConnectionStatus('disconnected');
        if (accountId) await fetchConfig(accountId);
        return;
      }
      toast.success(data.bot_username ? t('connectedAs', { username: data.bot_username }) : t('connectedSuccess'));
      setBotToken('');
      setConnectionStatus('connected');
      setStatusMessage('');
      if (data.webhook_url) setWebhookUrl(data.webhook_url);
      onConnected();
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('[telegram] save error', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/telegram/config', { method: 'GET', cache: 'no-store' });
      const payload = await res.json();
      if (payload.connected) {
        setConnectionStatus('connected');
        setStatusMessage('');
        if (payload.webhook_url) setWebhookUrl(payload.webhook_url);
        toast.success(payload.bot_username ? t('testConnectedAs', { username: payload.bot_username }) : t('testConnected'));
        if (payload.bot_username) setConfig((p) => ({ bot_username: payload.bot_username, bot_id: payload.bot_id, status: 'connected', connected_at: payload.connected_at ?? p?.connected_at ?? null }));
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(payload.message || '');
        toast.error(payload.message || t('testFailed'));
      }
    } catch {
      toast.error(t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/telegram/config', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectedSuccess'));
      setConfig(null);
      setConnectionStatus('disconnected');
      setStatusMessage('');
      setWebhookUrl('');
      setBotToken('');
      onDisconnected();
    } catch (err) {
      console.error('[telegram] disconnect error', err);
      toast.error(t('disconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  }

  function handleCopyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('webhookCopied'));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const isConnected = connectionStatus === 'connected';

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Status */}
      <Alert className={isConnected ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-card border-border'}>
        <div className="flex items-center gap-2">
          {isConnected ? <CheckCircle2 className="size-4 text-emerald-400" /> : <XCircle className="size-4 text-red-500" />}
          <AlertTitle className={isConnected ? 'text-emerald-200 mb-0' : 'text-foreground mb-0'}>
            {isConnected ? t('connectedHint') : t('notConnectedHint')}
          </AlertTitle>
        </div>
        <AlertDescription className="text-muted-foreground text-xs mt-1">
          {isConnected
            ? config?.bot_username
              ? t('connectedDescWithBot', { username: config.bot_username, id: String(config.bot_id ?? '') })
              : t('connectedDesc')
            : statusMessage || t('connectDesc')}
        </AlertDescription>
      </Alert>

      {config?.connected_at && isConnected ? (
        <p className="text-xs text-muted-foreground">
          {t('connectedSince', { date: new Date(config.connected_at).toLocaleString() })}
        </p>
      ) : null}

      {/* Bot token */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm flex items-center gap-2">
            <Send className="size-4 text-sky-500" /> {t('botTokenTitle')}
          </CardTitle>
          <CardDescription>{t('botTokenDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('botTokenLabel')}</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder={t('botTokenPlaceholder')}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10 font-mono text-sm"
                autoComplete="off"
                data-testid="telegram-bot-token-input"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t('botTokenHint')}</p>
          </div>

          {statusMessage && !isConnected ? (
            <Alert className="bg-amber-950/20 border-amber-700/30 py-2">
              <AlertTriangle className="size-4 text-amber-400" />
              <AlertDescription className="text-amber-200 text-xs">{statusMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || !canEditSettings}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {saving ? <><Loader2 className="size-4 animate-spin" /> {t('connecting')}</> : isConnected ? t('reconnect') : tChannels('connect')}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || loading}
              className="border-border text-muted-foreground hover:text-foreground"
            >
              {testing ? <><Loader2 className="size-4 animate-spin" /> {t('testing')}</> : t('testConnection')}
            </Button>
            {isConnected ? (
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnecting || !canEditSettings}
                className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
              >
                {disconnecting ? <><Loader2 className="size-4 animate-spin" /> {t('disconnecting')}</> : <><Trash2 className="size-4" /> {t('disconnect')}</>}
              </Button>
            ) : null}
          </div>
          {!canEditSettings ? (
            <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Webhook URL — only when connected */}
      {isConnected && webhookUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-sm">{t('webhookTitle')}</CardTitle>
            <CardDescription>{t('webhookDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">{t('webhookUrlLabel')}</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="bg-muted border-border text-muted-foreground font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={handleCopyWebhook} className="shrink-0 border-border">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
