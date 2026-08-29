// Provider-specific Telegram inbound-media mirror into `chat-media`.
// Keeps WhatsApp mirror untouched; follows same bucket contract (migration 023).

import { extensionForMime } from '@/lib/media/filename';
import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media';
import { getTelegramFile, downloadTelegramFile } from './api';

export interface TelegramMirrorStorage {
  from(bucket: string): {
    upload(path: string, body: Uint8Array | Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
}

export const TELEGRAM_MIRROR_BUCKET = 'chat-media';
export const TELEGRAM_MIRROR_FOLDER = 'telegram';

export function normalizeTelegramMime(mime?: string | null): string | null {
  if (!mime) return null;
  const base = mime.split(';')[0].trim().toLowerCase();
  return base.includes('/') ? base : null;
}

function kindForTelegramMime(mime: string | null): string {
  if (!mime) return 'file';
  const [top] = mime.split('/');
  if (top === 'image') return 'image';
  if (top === 'video') return 'video';
  if (top === 'audio') return 'audio';
  // application/*, text/*, etc. → document for UI bubble
  return 'document';
}

export function telegramMirrorObjectName(args: {
  providerMessageId: string;
  mimeType: string | null;
  fileName?: string | null;
  messageTimestamp?: string | number | null;
}): string {
  const { providerMessageId, mimeType, fileName, messageTimestamp } = args;
  const ext = extensionForMime(mimeType);
  const stem = (fileName ?? '').split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').trim();
  if (stem) return `${providerMessageId}-${stem}.${ext}`;
  const kind = kindForTelegramMime(mimeType);
  const stamp = String(messageTimestamp ?? '').replace(/\D/g, '');
  return `${providerMessageId}-${stamp ? `${kind}-${stamp}` : kind}.${ext}`;
}

export interface MirrorTelegramArgs {
  storage: TelegramMirrorStorage;
  accountId: string;
  botToken: string;
  fileId: string;
  providerMessageId: string;
  mimeType?: string | null;
  fileName?: string | null;
  messageTimestamp?: string | number | null;
}

/**
 * Fetch Telegram file via Bot API, download bytes, upload to chat-media/telegram/.
 * Best-effort: returns publicUrl or null (caller keeps [media] placeholder).
 */
export async function mirrorTelegramMedia(args: MirrorTelegramArgs): Promise<{ publicUrl: string | null; contentType: string | null }> {
  const { storage, accountId, botToken, fileId, providerMessageId, mimeType, fileName, messageTimestamp } = args;
  try {
    const fileInfo = await getTelegramFile(botToken, fileId);
    if (typeof fileInfo.fileSize === 'number' && fileInfo.fileSize > MEDIA_MAX_BYTES) {
      console.warn(`[telegram-mirror] skipping ${providerMessageId}: ${fileInfo.fileSize} bytes exceeds ${MEDIA_MAX_BYTES}`);
      return { publicUrl: null, contentType: null };
    }
    const { buffer, contentType: dlCt } = await downloadTelegramFile(botToken, fileInfo.filePath);
    if (buffer.byteLength > MEDIA_MAX_BYTES) {
      console.warn(`[telegram-mirror] skipping ${providerMessageId}: downloaded ${buffer.byteLength} bytes over limit`);
      return { publicUrl: null, contentType: null };
    }
    const uploadMime = normalizeTelegramMime(mimeType) ?? normalizeTelegramMime(dlCt) ?? 'application/octet-stream';
    const objectName = telegramMirrorObjectName({
      providerMessageId,
      mimeType: uploadMime,
      fileName,
      messageTimestamp: messageTimestamp as string | null,
    });
    const path = buildMediaPath(accountId, objectName, null, TELEGRAM_MIRROR_FOLDER);
    const { error } = await storage.from(TELEGRAM_MIRROR_BUCKET).upload(path, buffer, {
      contentType: uploadMime,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) {
      console.warn(`[telegram-mirror] upload failed ${providerMessageId} (${uploadMime}):`, error.message);
      return { publicUrl: null, contentType: null };
    }
    const {
      data: { publicUrl },
    } = storage.from(TELEGRAM_MIRROR_BUCKET).getPublicUrl(path);
    return { publicUrl: publicUrl || null, contentType: uploadMime };
  } catch (err) {
    console.warn(`[telegram-mirror] could not mirror ${providerMessageId}:`, err instanceof Error ? err.message : err);
    return { publicUrl: null, contentType: null };
  }
}

export function contentTypeForTelegramMime(mime: string | null): string {
  if (!mime) return 'document';
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('video/')) return 'video';
  if (base.startsWith('audio/')) return 'audio';
  return 'document';
}
