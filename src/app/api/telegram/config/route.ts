import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { getTelegramMe, setTelegramWebhook, deleteTelegramWebhook, TelegramApiError } from '@/lib/channels/telegram/api';

// We intentionally use the shared encryption primitive under whatsapp/encryption
// (core crypto), not a Telegram-specific copy.

function resolveWebhookBase(request: Request): string | null {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}`;
    } catch {
      // fall through to request-derived
    }
  }
  // Safe request-derived fallback — mirrors invite derivation care.
  // Prefer Origin header when present (browser-initiated), else Host/X-Forwarded-Host.
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        // Reject obvious localhost without explicit env, per requirements: fail clearly
        // We still allow it but the caller decides; here we return it and the POST
        // handler will reject loopback unless explicitly allowed in non-prod.
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      // ignore
    }
  }
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (host) {
    try {
      const maybe = `${proto}://${host}`;
      new URL(maybe);
      return maybe;
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.');
}

function buildWebhookUrl(request: Request, configId: string): { url: string | null; error: string | null } {
  const base = resolveWebhookBase(request);
  if (!base) {
    return { url: null, error: 'Cannot determine public URL for Telegram webhook. Set NEXT_PUBLIC_SITE_URL to your canonical https URL.' };
  }
  try {
    const u = new URL(base);
    if (isLoopbackHost(u.hostname)) {
      // Allow loopback only when explicitly opted in for local dev tunnels? We allow but warn via error unless NEXT_PUBLIC_SITE_URL is set.
      // Per spec: never silently register localhost. Fail clearly when cannot safely determine.
      const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
      if (!envUrl) {
        return {
          url: null,
          error: 'Public webhook URL would be localhost — set NEXT_PUBLIC_SITE_URL to your tunnel or deployed URL before connecting Telegram.',
        };
      }
    }
    return { url: `${base.replace(/\/$/, '')}/api/telegram/webhook/${configId}`, error: null };
  } catch {
    return { url: null, error: 'Invalid site URL configuration.' };
  }
}

// GET /api/telegram/config — safe status, never returns raw token
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { data: config, error } = await supabase
      .from('telegram_config')
      .select('id, bot_username, bot_id, status, connected_at, updated_at, bot_token_encrypted, webhook_secret_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      console.error('[telegram/config GET] db error', error);
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 });
    }
    if (!config) {
      return NextResponse.json({ connected: false, has_token: false, reason: 'no_config' }, { status: 200 });
    }

    let tokenOk = true;
    let botUsername: string | null = config.bot_username ?? null;
    let botId: number | null = config.bot_id ?? null;
    let lastProbeError: string | null = null;

    // Decrypt probe — if ENCRYPTION_KEY mismatched, token is corrupted
    try {
      const raw = decrypt(config.bot_token_encrypted);
      if (!raw) tokenOk = false;
      // Optional live probe — best-effort, never throw
      if (tokenOk && raw) {
        try {
          const me = await getTelegramMe(raw);
          botUsername = me.username;
          botId = me.id;
        } catch (err) {
          lastProbeError = err instanceof TelegramApiError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
          // Don't flip connected state solely on getMe failure; surface reason
        }
      }
    } catch {
      tokenOk = false;
      lastProbeError = 'The stored bot token cannot be decrypted — ENCRYPTION_KEY may have changed. Reconnect to fix.';
    }

    if (!tokenOk) {
      return NextResponse.json(
        {
          connected: false,
          has_token: true,
          needs_reset: true,
          reason: 'token_corrupted',
          message: lastProbeError,
          bot_username: botUsername,
          bot_id: botId,
          status: config.status,
          webhook_url: null as string | null,
        },
        { status: 200 },
      );
    }

    const { url: webhookUrl } = buildWebhookUrl(request, config.id);
    const connected = config.status === 'connected' && !lastProbeError;

    return NextResponse.json(
      {
        connected,
        has_token: true,
        reason: connected ? undefined : lastProbeError ? 'telegram_api_error' : undefined,
        message: lastProbeError ?? undefined,
        bot_username: botUsername,
        bot_id: botId,
        status: config.status,
        connected_at: config.connected_at,
        webhook_url: webhookUrl,
      },
      { status: 200 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/telegram/config — validate, encrypt, upsert, setWebhook
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { bot_token } = body as { bot_token?: unknown };
    if (typeof bot_token !== 'string' || !bot_token.trim()) {
      return NextResponse.json({ error: 'bot_token is required' }, { status: 400 });
    }
    const token = bot_token.trim();
    // Basic bot token shape: <digits>:<alphanumeric_->
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return NextResponse.json({ error: 'Invalid bot token format. Copy the token from BotFather — it looks like 123456:ABC-...' }, { status: 400 });
    }

    // Validate against Telegram before persisting
    let me: { id: number; username: string };
    try {
      me = await getTelegramMe(token);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        const status = err.code === 'invalid_token' ? 400 : err.status >= 500 ? 502 : 400;
        return NextResponse.json({ error: err.message }, { status });
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: `Telegram validation failed: ${msg}` }, { status: 400 });
    }

    // Encrypt
    let botTokenEncrypted: string;
    let webhookSecret: string;
    let webhookSecretEncrypted: string;
    try {
      botTokenEncrypted = encrypt(token);
      webhookSecret = crypto.randomBytes(32).toString('hex');
      webhookSecretEncrypted = encrypt(webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[telegram/config POST] encrypt failed', msg);
      return NextResponse.json({ error: 'Failed to encrypt credentials. Check ENCRYPTION_KEY.' }, { status: 500 });
    }

    // Upsert — one per account
    const { data: existing } = await supabase
      .from('telegram_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    let configId: string;
    if (existing) {
      configId = existing.id as string;
      const { error: updErr } = await supabase
        .from('telegram_config')
        .update({
          bot_token_encrypted: botTokenEncrypted,
          bot_username: me.username,
          bot_id: me.id,
          webhook_secret_encrypted: webhookSecretEncrypted,
          status: 'connected',
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', configId);
      if (updErr) {
        console.error('[telegram/config POST] update failed', updErr);
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('telegram_config')
        .insert({
          account_id: accountId,
          bot_token_encrypted: botTokenEncrypted,
          bot_username: me.username,
          bot_id: me.id,
          webhook_secret_encrypted: webhookSecretEncrypted,
          status: 'connected',
          connected_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (insErr || !inserted) {
        console.error('[telegram/config POST] insert failed', insErr);
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
      }
      configId = inserted.id as string;
    }

    // setWebhook — must succeed for connected to be meaningful
    const { url: webhookUrl, error: urlErr } = buildWebhookUrl(request, configId);
    if (urlErr || !webhookUrl) {
      // Row already saved — surface webhook error without rolling back token so user can retry
      return NextResponse.json(
        {
          success: false,
          saved: true,
          webhook_ok: false,
          webhook_error: urlErr,
          bot_username: me.username,
          bot_id: me.id,
          webhook_url: null as string | null,
        },
        { status: 200 },
      );
    }

    try {
      await setTelegramWebhook({ botToken: token, url: webhookUrl, secretToken: webhookSecret });
    } catch (err) {
      const msg = err instanceof TelegramApiError ? err.message : (err instanceof Error ? err.message : String(err));
      console.error('[telegram/config POST] setWebhook failed', msg);
      // Mark disconnected so status reflects webhook failure
      await supabase.from('telegram_config').update({ status: 'disconnected', updated_at: new Date().toISOString() }).eq('id', configId);
      return NextResponse.json(
        {
          success: false,
          saved: true,
          webhook_ok: false,
          webhook_error: msg,
          bot_username: me.username,
          bot_id: me.id,
          webhook_url: webhookUrl,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        saved: true,
        webhook_ok: true,
        bot_username: me.username,
        bot_id: me.id,
        webhook_url: webhookUrl,
        connected: true,
      },
      { status: 200 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/telegram/config — best-effort deleteWebhook then hard delete row
export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const { data: config } = await supabase
      .from('telegram_config')
      .select('id, bot_token_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json({ success: true, already_disconnected: true }, { status: 200 });
    }

    // Best-effort remove remote webhook
    try {
      const token = decrypt((config as { bot_token_encrypted: string }).bot_token_encrypted);
      await deleteTelegramWebhook(token);
      void request;
    } catch (err) {
      // Swallow decrypt/network errors — disconnect should still delete the row
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[telegram/config DELETE] deleteWebhook best-effort failed', msg);
    }

    const { error: delErr } = await supabase.from('telegram_config').delete().eq('id', (config as { id: string }).id);
    if (delErr) {
      console.error('[telegram/config DELETE] delete failed', delErr);
      return NextResponse.json({ error: 'Failed to disconnect Telegram' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
