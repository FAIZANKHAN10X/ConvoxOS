import { describe, it, expect } from 'vitest';
import { telegramMirrorObjectName, contentTypeForTelegramMime, normalizeTelegramMime } from './mirror';

describe('telegram mirror helpers', () => {
  it('normalizeTelegramMime lowercases and strips params', () => {
    expect(normalizeTelegramMime('image/jpeg; codecs=foo')).toBe('image/jpeg');
    expect(normalizeTelegramMime('IMAGE/PNG')).toBe('image/png');
    expect(normalizeTelegramMime(null)).toBeNull();
    expect(normalizeTelegramMime('bad')).toBeNull();
  });

  it('contentTypeForTelegramMime maps to image/document/video/audio', () => {
    expect(contentTypeForTelegramMime('image/jpeg')).toBe('image');
    expect(contentTypeForTelegramMime('video/mp4')).toBe('video');
    expect(contentTypeForTelegramMime('audio/ogg')).toBe('audio');
    expect(contentTypeForTelegramMime('application/pdf')).toBe('document');
    expect(contentTypeForTelegramMime(null)).toBe('document');
  });

  it('telegramMirrorObjectName keeps stem from filename', () => {
    const name = telegramMirrorObjectName({
      providerMessageId: 'tg_1_2',
      mimeType: 'application/pdf',
      fileName: 'invoice.pdf',
      messageTimestamp: 123,
    });
    expect(name).toContain('invoice');
    expect(name).toContain('tg_1_2');
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('telegramMirrorObjectName synthesizes kind-timestamp when no filename', () => {
    const name = telegramMirrorObjectName({
      providerMessageId: 'tg_1_2',
      mimeType: 'image/jpeg',
      fileName: null,
      messageTimestamp: 1234567890,
    });
    expect(name).toContain('image-1234567890');
  });
});
