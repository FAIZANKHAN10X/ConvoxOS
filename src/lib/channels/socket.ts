/**
 * Thin explicit Channel Socket — channel dispatch for Flows/Automations.
 *
 * Keeps provider-specific payload formatting and provider API logic inside
 * the channel implementations (whatsapp/send-message, telegram/send*).
 * This file only dispatches based on resolved channel and surfaces
 * normalized identity/connection errors. No ChannelFactory/Registry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';
import { sendTelegramText, SendTelegramError } from '@/lib/channels/telegram/send';
import { sendTelegramMedia } from '@/lib/channels/telegram/send-media';
import type { TelegramInlineMarkup } from '@/lib/channels/telegram/keyboard';

export type SocketChannel = 'whatsapp' | 'telegram';

export class ChannelSocketError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ChannelSocketError';
    this.code = code;
    this.status = status;
  }
}

export interface SocketTextArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  channel: SocketChannel;
  text: string;
  replyToMessageId?: string | null;
  inlineKeyboard?: TelegramInlineMarkup | null;
  /**
   * Stable automation key (run:node:block). Senders short-circuit on
   * an already-persisted row so engine retries never double-send.
   * Omitted for manual sends.
   */
  idempotencyKey?: string | null;
}

export interface SocketMediaArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  channel: SocketChannel;
  mediaKind: 'image' | 'video' | 'document' | 'audio' | 'voice';
  mediaUrl: string;
  filename?: string | null;
  caption?: string | null;
  replyToMessageId?: string | null;
  inlineKeyboard?: TelegramInlineMarkup | null;
  /** Stable automation key — see SocketTextArgs. */
  idempotencyKey?: string | null;
}

export interface SocketInteractiveArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  channel: SocketChannel;
  payload: import('@/lib/whatsapp/interactive').InteractiveMessagePayload | TelegramInlineMarkup;
  replyToMessageId?: string | null;
  /** Stable automation key — see SocketTextArgs. */
  idempotencyKey?: string | null;
}

/**
 * Dispatch text (optionally with inline keyboard for Telegram) to the resolved channel.
 * Delegates to existing channel senders — no duplication.
 */
export async function dispatchText(args: SocketTextArgs): Promise<{ providerMessageId: string; messageId: string }> {
  const { db, accountId, conversationId, channel, text, replyToMessageId, inlineKeyboard, idempotencyKey } = args;

  if (channel === 'telegram') {
    const result = await sendTelegramText(db, accountId, {
      conversationId,
      contentText: text,
      replyToMessageId: replyToMessageId ?? null,
      inlineKeyboard: inlineKeyboard ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });
    return { providerMessageId: result.telegramMessageId, messageId: result.messageId };
  }

  if (channel === 'whatsapp') {
    try {
      const result = await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: 'text',
        contentText: text,
        replyToMessageId: replyToMessageId ?? null,
        idempotencyKey: idempotencyKey ?? null,
      });
      return { providerMessageId: result.whatsappMessageId, messageId: result.messageId };
    } catch (err) {
      if (err instanceof SendMessageError) {
        // Normalize WhatsApp identity/connection codes to socket-level
        if (err.code === 'bad_request' && err.message.includes('phone')) {
          throw new ChannelSocketError('target_identity_missing', err.message, 400);
        }
        if (err.code === 'whatsapp_not_configured') {
          throw new ChannelSocketError('channel_disconnected', err.message, 400);
        }
        throw new ChannelSocketError(err.code, err.message, err.status);
      }
      throw err;
    }
  }

  throw new ChannelSocketError('unsupported_channel', `Unsupported channel: ${channel}`, 400);
}

/**
 * Dispatch media (image/video/document/audio/voice) to the resolved channel.
 * Telegram now supports image|document|video|audio|voice via public chat-media URL;
 * WhatsApp supports image|video|document|audio via same media_url.
 */
export async function dispatchMedia(args: SocketMediaArgs): Promise<{ providerMessageId: string; messageId: string }> {
  const { db, accountId, conversationId, channel, mediaKind, mediaUrl, filename, caption, replyToMessageId, inlineKeyboard, idempotencyKey } = args;

  if (channel === 'telegram') {
    // Telegram send-media handles image|document|video|audio|voice + optional inline keyboard
    try {
      const result = await sendTelegramMedia(db, accountId, {
        conversationId,
        mediaUrl,
        mediaKind: mediaKind as 'image' | 'document' | 'video' | 'audio' | 'voice',
        filename: filename ?? null,
        caption: caption ?? null,
        replyToMessageId: replyToMessageId ?? null,
        inlineKeyboard: inlineKeyboard ?? null,
        idempotencyKey: idempotencyKey ?? null,
      });
      return { providerMessageId: result.telegramMessageId, messageId: result.messageId };
    } catch (err) {
      if (err instanceof SendTelegramError) {
        if (err.code === 'bad_request' && err.message.includes('Telegram chat')) {
          throw new ChannelSocketError('target_identity_missing', err.message, 400);
        }
        if (err.code === 'telegram_not_configured') {
          throw new ChannelSocketError('channel_disconnected', err.message, 400);
        }
        throw new ChannelSocketError(err.code, err.message, err.status);
      }
      throw err;
    }
  }

  if (channel === 'whatsapp') {
    // Map voice → audio for WhatsApp (Telegram voice is audio/ogg, WhatsApp audio expects no caption)
    const waKind = mediaKind === 'voice' ? 'audio' : mediaKind;
    if (waKind !== 'image' && waKind !== 'video' && waKind !== 'document' && waKind !== 'audio') {
      throw new ChannelSocketError('capability_not_supported', `WhatsApp does not support media kind: ${mediaKind}`, 400);
    }
    try {
      const result = await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: waKind,
        contentText: caption ?? null,
        mediaUrl,
        filename: filename ?? null,
        replyToMessageId: replyToMessageId ?? null,
        idempotencyKey: idempotencyKey ?? null,
      });
      return { providerMessageId: result.whatsappMessageId, messageId: result.messageId };
    } catch (err) {
      if (err instanceof SendMessageError) {
        if (err.code === 'bad_request' && err.message.includes('phone')) {
          throw new ChannelSocketError('target_identity_missing', err.message, 400);
        }
        if (err.code === 'whatsapp_not_configured') {
          throw new ChannelSocketError('channel_disconnected', err.message, 400);
        }
        throw new ChannelSocketError(err.code, err.message, err.status);
      }
      throw err;
    }
  }

  throw new ChannelSocketError('unsupported_channel', `Unsupported channel: ${channel}`, 400);
}

/**
 * Dispatch interactive (buttons/list for WhatsApp, inline keyboard for Telegram).
 * Provider-specific payload shapes stay in their modules — socket only dispatches.
 */
export async function dispatchInteractive(args: SocketInteractiveArgs): Promise<{ providerMessageId: string; messageId: string }> {
  const { db, accountId, conversationId, channel, payload, replyToMessageId, idempotencyKey } = args;

  if (channel === 'telegram') {
    const markup = payload as TelegramInlineMarkup;
    // Reuse text dispatch with keyboard, using a placeholder text for interactive
    // Telegram interactive is always inline keyboard attached to a message — use payload text as body
    // For backwards compat with existing WhatsApp interactive tests, keep simple
    const text = (payload as unknown as { body?: string; text?: string }).body ?? (payload as unknown as { text?: string }).text ?? 'Choose an option:';
    return dispatchText({
      db,
      accountId,
      conversationId,
      channel: 'telegram',
      text,
      replyToMessageId: replyToMessageId ?? null,
      inlineKeyboard: markup,
      idempotencyKey: idempotencyKey ?? null,
    });
  }

  if (channel === 'whatsapp') {
    const waPayload = payload as import('@/lib/whatsapp/interactive').InteractiveMessagePayload;
    try {
      const result = await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: 'interactive',
        interactivePayload: waPayload,
        replyToMessageId: replyToMessageId ?? null,
        idempotencyKey: idempotencyKey ?? null,
      });
      return { providerMessageId: result.whatsappMessageId, messageId: result.messageId };
    } catch (err) {
      if (err instanceof SendMessageError) {
        throw new ChannelSocketError(err.code, err.message, err.status);
      }
      throw err;
    }
  }

  throw new ChannelSocketError('unsupported_channel', `Unsupported channel: ${channel}`, 400);
}

/**
 * Resolve `current` → trigger_channel snapshot, else explicit.
 * Pure helper — keeps engine readable, no DB.
 */
export function resolveChannelTarget(
  channelTarget: string | undefined | null,
  triggerChannel: string | null | undefined,
): SocketChannel | null {
  if (!channelTarget || channelTarget === 'current') {
    if (!triggerChannel) return null; // no conversational context
    if (triggerChannel === 'whatsapp' || triggerChannel === 'telegram') return triggerChannel as SocketChannel;
    return null;
  }
  if (channelTarget === 'whatsapp' || channelTarget === 'telegram') return channelTarget as SocketChannel;
  return null;
}
