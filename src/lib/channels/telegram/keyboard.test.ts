import { describe, it, expect } from 'vitest';
import { validateTelegramInlineMarkup, toTelegramReplyMarkup } from './keyboard';

describe('validateTelegramInlineMarkup', () => {
  it('accepts callback button', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] })).toEqual({ ok: true });
  });
  it('accepts url button', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 'Visit', url: 'https://example.com' }]] })).toEqual({ ok: true });
  });
  it('accepts mixed rows and disabled', () => {
    expect(
      validateTelegramInlineMarkup({
        inline_keyboard: [
          [{ text: 'A', callback_data: 'a' }, { text: 'B', url: 'https://b.com' }],
          [{ text: 'C', callback_data: 'c', disabled: true }],
        ],
      }),
    ).toEqual({ ok: true });
  });
  it('rejects empty text', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: '', callback_data: 'a' }]] }).ok).toBe(false);
  });
  it('rejects text >64', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 'x'.repeat(65), callback_data: 'a' }]] }).ok).toBe(false);
  });
  it('rejects callback_data >64 bytes', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 't', callback_data: 'x'.repeat(65) }]] }).ok).toBe(false);
  });
  it('rejects missing callback_data and url', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 't' } as never]] }).ok).toBe(false);
  });
  it('rejects both callback_data and url', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 't', callback_data: 'a', url: 'https://a.com' } as never]] }).ok).toBe(false);
  });
  it('rejects invalid url', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 't', url: 'not-a-url' }]] }).ok).toBe(false);
  });
  it('rejects unsupported web_app', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[{ text: 't', web_app: {} } as never]] }).ok).toBe(false);
  });
  it('rejects empty keyboard', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [] }).ok).toBe(false);
  });
  it('rejects empty row', () => {
    expect(validateTelegramInlineMarkup({ inline_keyboard: [[]] }).ok).toBe(false);
  });
  it('rejects >8 per row', () => {
    const row = Array.from({ length: 9 }, (_, i) => ({ text: `t${i}`, callback_data: `c${i}` }));
    expect(validateTelegramInlineMarkup({ inline_keyboard: [row] }).ok).toBe(false);
  });
  it('rejects >8 rows', () => {
    const kb = Array.from({ length: 9 }, () => [{ text: 't', callback_data: 'c' }]);
    expect(validateTelegramInlineMarkup({ inline_keyboard: kb }).ok).toBe(false);
  });
  it('rejects >64 total', () => {
    const kb = Array.from({ length: 8 }, () => Array.from({ length: 9 }, (_, i) => ({ text: `t${i}`, callback_data: `c${i}` })));
    // 8*9=72 >64
    expect(validateTelegramInlineMarkup({ inline_keyboard: kb }).ok).toBe(false);
  });
  it('toTelegramReplyMarkup omits disabled:false', () => {
    const out = toTelegramReplyMarkup({ inline_keyboard: [[{ text: 't', callback_data: 'c', disabled: false }]] }) as { inline_keyboard: Array<Array<{ disabled?: boolean }>> };
    expect(out.inline_keyboard[0][0].disabled).toBeUndefined();
    const out2 = toTelegramReplyMarkup({ inline_keyboard: [[{ text: 't', callback_data: 'c', disabled: true }]] }) as { inline_keyboard: Array<Array<{ disabled?: boolean }>> };
    expect(out2.inline_keyboard[0][0].disabled).toBe(true);
  });
  it('returns undefined for null', () => {
    expect(toTelegramReplyMarkup(null)).toBeUndefined();
  });
});
