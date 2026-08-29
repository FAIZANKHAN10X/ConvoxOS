// Telegram Bot API helpers — provider-specific, no CRM core import.

export class TelegramApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.name = 'TelegramApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface TelegramMe {
  id: number;
  username: string;
  firstName?: string;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function sanitizeTelegramMessage(raw: string, fallback: string): string {
  const msg = raw.trim();
  if (!msg) return fallback;
  // Never echo token-like content; Telegram descriptions are short English phrases
  // like "Unauthorized" / "Not Found". Map known cases, else generic.
  const lower = msg.toLowerCase();
  if (lower.includes('unauthorized') || lower.includes('invalid token')) {
    return 'Invalid bot token — check the token from BotFather.';
  }
  if (lower.includes('not found')) return 'Telegram resource not found.';
  if (lower.includes('too many requests') || lower.includes('retry after')) {
    return 'Telegram is rate limiting requests — try again shortly.';
  }
  if (lower.includes('webhook')) return 'Telegram webhook configuration failed.';
  // Generic safe fallback — truncate to avoid leaking large provider payloads
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

async function telegramFetch(botToken: string, method: string, body?: Record<string, unknown>) {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
  const init: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  };
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TelegramApiError('network_error', `Could not reach Telegram: ${sanitizeTelegramMessage(msg, 'Network error')}`, 502, true);
  }
  let json: { ok?: boolean; result?: unknown; description?: string; error_code?: number; parameters?: { retry_after?: number } } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    if (!res.ok) {
      throw new TelegramApiError('telegram_error', `Telegram error ${res.status}`, res.status >= 500 ? 502 : 400, res.status >= 500);
    }
    return json;
  }
  if (res.ok && json.ok) return json;
  // Telegram may return 200 with ok:false or non-2xx with description
  const descRaw = json.description ?? `Telegram error ${res.status}`;
  const desc = sanitizeTelegramMessage(descRaw, `Telegram error ${res.status}`);
  const status = res.status === 401 || res.status === 404 ? 400 : res.status >= 500 ? 502 : 400;
  const retryable = res.status === 429 || res.status >= 500;
  // Map auth failures to 400 so the UI shows "invalid token" not 401/502 leak
  const code = lowerDesc(descRaw).includes('unauthorized') || descRaw.toLowerCase().includes('invalid token')
    ? 'invalid_token'
    : res.status === 429
      ? 'rate_limited'
      : 'telegram_error';
  throw new TelegramApiError(code, desc, status, retryable);
}

function lowerDesc(s: string) {
  return s.toLowerCase();
}

export async function getTelegramMe(botToken: string): Promise<TelegramMe> {
  const json = await telegramFetch(botToken, 'getMe');
  const r = json.result as { id?: number; username?: string; first_name?: string } | undefined;
  if (typeof r?.id !== 'number' || typeof r?.username !== 'string') {
    throw new TelegramApiError('telegram_error', 'Telegram returned an invalid bot identity.', 502);
  }
  return { id: r.id, username: r.username, firstName: r.first_name };
}

export async function setTelegramWebhook(opts: { botToken: string; url: string; secretToken: string }): Promise<void> {
  await telegramFetch(opts.botToken, 'setWebhook', {
    url: opts.url,
    secret_token: opts.secretToken,
  });
}

export async function deleteTelegramWebhook(botToken: string): Promise<void> {
  try {
    await telegramFetch(botToken, 'deleteWebhook', { drop_pending_updates: false });
  } catch (err) {
    // Best-effort — 401 already handled as invalid_token, otherwise swallow network 502 for delete
    if (err instanceof TelegramApiError && err.code === 'invalid_token') throw err;
    // For delete, treat non-auth errors as non-fatal so disconnect still succeeds
    if (err instanceof TelegramApiError && err.status >= 500) return;
    throw err;
  }
}

export async function getTelegramWebhookInfo(botToken: string): Promise<{ url: string; hasCustomCertificate: boolean; pendingUpdateCount: number }> {
  const json = await telegramFetch(botToken, 'getWebhookInfo');
  const r = json.result as { url?: string; has_custom_certificate?: boolean; pending_update_count?: number } | undefined;
  return {
    url: typeof r?.url === 'string' ? r.url : '',
    hasCustomCertificate: !!r?.has_custom_certificate,
    pendingUpdateCount: typeof r?.pending_update_count === 'number' ? r.pending_update_count : 0,
  };
}
