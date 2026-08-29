// Provider-specific Telegram inline keyboard model.
// Keep inside src/lib/channels/telegram/ — do NOT extend whatsapp/interactive.ts.

export interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  disabled?: boolean;
}

export interface TelegramInlineMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

export type TelegramKeyboardKind = 'telegram_inline';

export interface TelegramInteractivePayload {
  kind: TelegramKeyboardKind;
  markup: TelegramInlineMarkup;
}

// ConvoxOS safety limits (not Telegram hard limits) — Telegram only
// requires text non-empty and callback_data 1-64 bytes / url valid.
// We cap grid to keep composer preview manageable.
const MAX_TEXT_CHARS = 64;
const MAX_CALLBACK_BYTES = 64;
const MAX_ROWS = 8;
const MAX_PER_ROW = 8;
const MAX_TOTAL = 64;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateTelegramInlineMarkup(markup: unknown): { ok: true } | { ok: false; error: string } {
  if (!markup || typeof markup !== 'object') return { ok: false, error: 'Keyboard must be an object with inline_keyboard' };
  const m = markup as Record<string, unknown>;
  const kb = m.inline_keyboard;
  if (!Array.isArray(kb)) return { ok: false, error: 'inline_keyboard must be an array' };
  if (kb.length === 0) return { ok: false, error: 'Keyboard must have at least one row' };
  if (kb.length > MAX_ROWS) return { ok: false, error: `Too many rows: ${kb.length} > ${MAX_ROWS}` };

  let total = 0;
  for (let r = 0; r < kb.length; r++) {
    const row = kb[r];
    if (!Array.isArray(row)) return { ok: false, error: `Row ${r + 1} must be an array` };
    if (row.length === 0) return { ok: false, error: `Row ${r + 1} must have at least one button` };
    if (row.length > MAX_PER_ROW) return { ok: false, error: `Row ${r + 1} has too many buttons: ${row.length} > ${MAX_PER_ROW}` };
    total += row.length;
    if (total > MAX_TOTAL) return { ok: false, error: `Too many buttons: ${total} > ${MAX_TOTAL}` };

    for (let c = 0; c < row.length; c++) {
      const btn = row[c] as Record<string, unknown>;
      if (!btn || typeof btn !== 'object') return { ok: false, error: `Button ${r + 1}:${c + 1} must be an object` };

      // Reject unsupported variants explicitly
      const unsupported = ['web_app', 'login_url', 'switch_inline_query', 'switch_inline_query_current_chat', 'switch_inline_query_chosen_chat', 'copy_text', 'callback_game', 'pay'];
      for (const k of unsupported) {
        if (k in btn) return { ok: false, error: `Unsupported button type: ${k}` };
      }

      const text = btn.text;
      if (typeof text !== 'string' || !text.trim()) return { ok: false, error: `Button ${r + 1}:${c + 1} text is required` };
      if (text.length > MAX_TEXT_CHARS) return { ok: false, error: `Button ${r + 1}:${c + 1} text exceeds ${MAX_TEXT_CHARS} chars` };

      const hasCallback = typeof btn.callback_data === 'string';
      const hasUrl = typeof btn.url === 'string';
      if (hasCallback === hasUrl) {
        // exactly one of callback_data or url required
        return { ok: false, error: `Button ${r + 1}:${c + 1} must have exactly one of callback_data or url` };
      }
      if (hasCallback) {
        const cb = btn.callback_data as string;
        const bytes = byteLength(cb);
        if (bytes < 1 || bytes > MAX_CALLBACK_BYTES) return { ok: false, error: `Button ${r + 1}:${c + 1} callback_data must be 1-${MAX_CALLBACK_BYTES} bytes` };
      }
      if (hasUrl) {
        const url = btn.url as string;
        if (!isValidUrl(url)) return { ok: false, error: `Button ${r + 1}:${c + 1} url must be a valid http(s) URL` };
      }
      if ('disabled' in btn && typeof btn.disabled !== 'boolean') {
        return { ok: false, error: `Button ${r + 1}:${c + 1} disabled must be a boolean` };
      }
    }
  }
  return { ok: true };
}

export function toTelegramReplyMarkup(markup: TelegramInlineMarkup | null): Record<string, unknown> | undefined {
  if (!markup) return undefined;
  // Omit disabled:false to keep payload minimal (Telegram 10.3 optional)
  const sanitized: TelegramInlineMarkup = {
    inline_keyboard: markup.inline_keyboard.map((row) =>
      row.map((btn) => {
        const out: Record<string, unknown> = { text: btn.text };
        if (btn.callback_data !== undefined) out.callback_data = btn.callback_data;
        if (btn.url !== undefined) out.url = btn.url;
        if (btn.disabled) out.disabled = true;
        return out as unknown as TelegramInlineButton;
      }),
    ),
  };
  return sanitized as unknown as Record<string, unknown>;
}

export function blankTelegramInline(): TelegramInlineMarkup {
  return { inline_keyboard: [[{ text: '', callback_data: '' }]] };
}
