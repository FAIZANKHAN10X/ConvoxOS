'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';

export function TelegramConfigPlaceholder({
  connected,
}: {
  connected: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
}) {
  const t = useTranslations('Settings.telegram');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className={connected ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-card border-border'}>
            <Info className="size-4" />
            <AlertTitle className={connected ? 'text-emerald-200' : 'text-foreground'}>
              {connected ? t('connectedHint') : t('notConnectedHint')}
            </AlertTitle>
            <AlertDescription className="text-muted-foreground text-xs">
              {connected ? t('connectedDesc') : t('connectDesc')}
            </AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('comingSoon')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
