'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export function useChannelStatus() {
  const { accountId } = useAuth();
  const [telegramConnected, setTelegramConnected] = useState<boolean | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTelegramConnected(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWhatsappConnected(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.from('telegram_config').select('status').eq('account_id', accountId).maybeSingle(),
      supabase.from('whatsapp_config').select('status').eq('account_id', accountId).maybeSingle(),
    ]).then(([tg, wa]) => {
      if (cancelled) return;
      setTelegramConnected(tg.data?.status === 'connected');
      setWhatsappConnected(wa.data?.status === 'connected');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return { telegramConnected, whatsappConnected, loading };
}
