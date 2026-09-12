'use client';

import { useEffect, useState } from 'react';
import { MessageCircle, Send, Mail } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';

import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppConfig } from './whatsapp-config';
import { TelegramConfig } from './telegram-config';
import { EmailConfig } from './email-config';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type ChannelId = 'whatsapp' | 'telegram' | 'email';
type ConnectionState = 'connected' | 'not_connected' | 'loading';

function ChannelCard({
  id,
  state,
  onAction,
  actionLabel,
  isExpanded,
}: {
  id: ChannelId;
  state: ConnectionState;
  onAction: () => void;
  actionLabel: string;
  isExpanded?: boolean;
}) {
  const t = useTranslations('Settings.channels');
  const isConnected = state === 'connected';
  const accent =
    id === 'whatsapp'
      ? 'bg-emerald-500/15 text-emerald-500'
      : id === 'telegram'
        ? 'bg-sky-500/15 text-sky-500'
        : 'bg-violet-500/15 text-violet-500';
  const Icon = id === 'whatsapp' ? MessageCircle : id === 'telegram' ? Send : Mail;
  const title =
    id === 'whatsapp' ? t('whatsappTitle') : id === 'telegram' ? t('telegramTitle') : t('emailTitle');
  const desc =
    id === 'whatsapp' ? t('whatsappDesc') : id === 'telegram' ? t('telegramDesc') : t('emailDesc');
  return (
    <Card className={isExpanded ? 'ring-1 ring-primary/20' : undefined}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-9 items-center justify-center rounded-lg ${accent}`}
          >
            <Icon className="size-5" />
          </span>
          <div>
            <CardTitle className="text-sm">
              {title}
            </CardTitle>
            <CardDescription className="text-xs">
              {desc}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state === 'loading' ? (
            <Badge variant="secondary" className="text-xs">
              {t('checking')}
            </Badge>
          ) : isConnected ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
              ● {t('connected')}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground">
              ○ {t('notConnected')}
            </Badge>
          )}
          <button
            type="button"
            onClick={onAction}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            {actionLabel}
          </button>
        </div>
      </CardHeader>
      {isConnected && id === 'whatsapp' ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{t('whatsappConnectedHint')}</p>
        </CardContent>
      ) : null}
      {!isConnected && id === 'telegram' ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{t('telegramNotConnectedHint')}</p>
        </CardContent>
      ) : null}
      {!isConnected && id === 'email' ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{t('emailNotConnectedHint')}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function ChannelsPanel() {
  const t = useTranslations('Settings.channels');
  const { accountId } = useAuth();
  const [whatsappState, setWhatsappState] = useState<ConnectionState>('loading');
  const [telegramState, setTelegramState] = useState<ConnectionState>('loading');
  const [emailState, setEmailState] = useState<ConnectionState>('loading');
  const [expanded, setExpanded] = useState<ChannelId | null>(null);

  useEffect(() => {
    if (!accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWhatsappState('not_connected');
       
      setTelegramState('not_connected');
       
      setEmailState('not_connected');
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [waRes, tgRes, emRes] = await Promise.allSettled([
        supabase.from('whatsapp_config').select('status').eq('account_id', accountId).maybeSingle(),
        supabase.from('telegram_config').select('status').eq('account_id', accountId).maybeSingle(),
        supabase.from('email_config').select('status').eq('account_id', accountId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (waRes.status === 'fulfilled' && waRes.value.data?.status === 'connected') {
        setWhatsappState('connected');
      } else {
        setWhatsappState('not_connected');
      }
      if (tgRes.status === 'fulfilled' && tgRes.value.data?.status === 'connected') {
        setTelegramState('connected');
      } else {
        setTelegramState('not_connected');
      }
      if (emRes.status === 'fulfilled' && (emRes.value.data as { status?: string } | null)?.status === 'connected') {
        setEmailState('connected');
      } else {
        setEmailState('not_connected');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const whatsappAction = expanded === 'whatsapp' ? t('close') : whatsappState === 'connected' ? t('manage') : t('connect');
  const telegramAction = expanded === 'telegram' ? t('close') : telegramState === 'connected' ? t('manage') : t('connect');
  const emailAction = expanded === 'email' ? t('close') : emailState === 'connected' ? t('manage') : t('connect');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="space-y-3">
        <ChannelCard
          id="whatsapp"
          state={whatsappState}
          actionLabel={whatsappAction}
          isExpanded={expanded === 'whatsapp'}
          onAction={() => setExpanded((cur) => (cur === 'whatsapp' ? null : 'whatsapp'))}
        />
        {expanded === 'whatsapp' ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <WhatsAppConfig />
          </div>
        ) : null}

        <ChannelCard
          id="telegram"
          state={telegramState}
          actionLabel={telegramAction}
          isExpanded={expanded === 'telegram'}
          onAction={() => setExpanded((cur) => (cur === 'telegram' ? null : 'telegram'))}
        />
        {expanded === 'telegram' ? (
          <div className="rounded-xl border border-border bg-card p-0">
            <div className="p-4">
              <TelegramConfig
                onConnected={() => setTelegramState('connected')}
                onDisconnected={() => setTelegramState('not_connected')}
              />
            </div>
          </div>
        ) : null}

        <ChannelCard
          id="email"
          state={emailState}
          actionLabel={emailAction}
          isExpanded={expanded === 'email'}
          onAction={() => setExpanded((cur) => (cur === 'email' ? null : 'email'))}
        />
        {expanded === 'email' ? (
          <div className="rounded-xl border border-border bg-card p-0">
            <div className="p-4">
              <EmailConfig
                onConnected={() => setEmailState('connected')}
                onDisconnected={() => setEmailState('not_connected')}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
