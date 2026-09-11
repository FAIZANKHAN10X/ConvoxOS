import { z } from 'zod';

import {
  ChannelSocketError,
  dispatchInteractive,
  dispatchMedia,
  dispatchText,
} from '@/lib/channels/socket';
import { messageBlockKey } from '@/lib/messaging/idempotency';
import type { TelegramInlineMarkup } from '@/lib/channels/telegram/keyboard';

import { CHANNEL_FIELD_LABELS } from '../present';
import { NodeExecutionError } from '../types';
import type { BlockDefinition, NodeDefinition } from '../types';
import { resolveConversationChannel } from './channel';
import { asDb } from './db';

const MAX_TEXT_CHARS = 4096;
const MAX_CAPTION_CHARS = 1024;
const MAX_BUTTON_LABEL_CHARS = 20;
const MAX_BUTTON_ID_BYTES = 64;
const MAX_DELAY_SECONDS = 30;
const WHATSAPP_BUTTON_CAP = 3;
const TELEGRAM_BUTTON_CAP = 10;

const textBlock: BlockDefinition = {
  blockType: 'text',
  label: 'Text',
  description: 'A text bubble, sent in order',
  configSchema: z.object({ text: z.string().min(1).max(MAX_TEXT_CHARS) }),
  preview: true,
  emptyPrompt: 'Write the message…',
};

const imageBlock: BlockDefinition = {
  blockType: 'image',
  label: 'Image',
  description: 'A hosted image with optional caption',
  configSchema: z.object({
    mediaUrl: z.string().url().startsWith('https://'),
    caption: z.string().max(MAX_CAPTION_CHARS).optional(),
  }),
  emptyPrompt: 'Paste an image URL…',
};

const delayBlock: BlockDefinition = {
  blockType: 'delay',
  label: 'Typing pause',
  description: 'A short natural pause before the next block',
  configSchema: z.object({
    seconds: z.number().int().min(1).max(MAX_DELAY_SECONDS),
  }),
};

const buttonRow = z.object({
  id: z.string().min(1).max(MAX_BUTTON_ID_BYTES),
  label: z.string().min(1).max(MAX_BUTTON_LABEL_CHARS),
  url: z.string().url().startsWith('https://').optional(),
});

const buttonsBlock: BlockDefinition = {
  blockType: 'buttons',
  label: 'Buttons',
  description: 'Tappable replies, each with its own path',
  configSchema: z.object({
    buttons: z.array(buttonRow).min(1).max(TELEGRAM_BUTTON_CAP),
  }),
};

const blockInstance = z.object({
  id: z.string().min(1),
  blockType: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

const messageConfig = z.object({
  channel: z.enum(['current', 'whatsapp', 'telegram']).default('current'),
  blocks: z.array(blockInstance).optional(),
});

type MessageConfig = z.infer<typeof messageConfig>;

interface ButtonRow {
  id: string;
  label: string;
  url?: string;
}

function buttonRowsOf(blocks: MessageConfig['blocks']): ButtonRow[] {
  const rows: ButtonRow[] = [];
  for (const block of blocks ?? []) {
    if (block.blockType !== 'buttons') continue;
    const list = (block.config ?? {}) as { buttons?: unknown };
    if (!Array.isArray(list.buttons)) continue;
    for (const row of list.buttons) {
      if (!row || typeof row !== 'object') continue;
      const candidate = row as Partial<ButtonRow>;
      if (typeof candidate.id === 'string' && typeof candidate.label === 'string') {
        rows.push({
          id: candidate.id,
          label: candidate.label,
          url: typeof candidate.url === 'string' ? candidate.url : undefined,
        });
      }
    }
  }
  return rows;
}

function firstTextBody(blocks: MessageConfig['blocks']): string | null {
  for (const block of blocks ?? []) {
    if (block.blockType !== 'text') continue;
    const text = (block.config ?? {}) as { text?: unknown };
    if (typeof text.text === 'string' && text.text.trim()) return text.text;
  }
  return null;
}

export const messageNode: NodeDefinition<MessageConfig> = {
  type: 'message.send',
  kind: 'action',
  label: 'Message',
  description: 'Send message blocks in order on the conversation',
  category: 'communication',
  fieldLabels: { channel: CHANNEL_FIELD_LABELS },
  configSchema: messageConfig,
  preview: 'message',
  emptyPrompt: 'Add a message block',
  blocks: [textBlock, imageBlock, delayBlock, buttonsBlock],
  dynamicPorts: {
    field: 'blocks',
    match: { field: 'blockType', equals: 'buttons' },
    itemsField: 'config.buttons',
    idField: 'id',
    labelField: 'label',
    skipWhen: { field: 'url', present: true },
    requireAll: true,
    keepBase: true,
  },
  flags: { pausesFlowBlocks: ['buttons'] },
  summarize(config) {
    const body = firstTextBody(config.blocks);
    if (body) {
      const text = body.trim();
      return text.length > 72 ? `${text.slice(0, 72)}…` : text;
    }
    const count = config.blocks?.length ?? 0;
    return count > 0 ? `${count} block${count === 1 ? '' : 's'}` : 'Add a message block';
  },
  validate(config) {
    const blocks = config.blocks ?? [];
    if (blocks.length === 0) return ['Add at least one message block'];
    const issues: string[] = [];
    const rows = buttonRowsOf(config.blocks);
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) issues.push(`duplicate button id "${row.id}"`);
      seen.add(row.id);
    }
    const flowButtons = rows.filter((row) => !row.url);
    const cap =
      config.channel === 'telegram' ? TELEGRAM_BUTTON_CAP : WHATSAPP_BUTTON_CAP;
    if (flowButtons.length > cap) {
      const where =
        config.channel === 'telegram'
          ? 'Telegram allows up to 10 buttons per message'
          : 'WhatsApp allows up to 3 buttons per message (Telegram allows 10) — set an explicit channel or remove buttons';
      issues.push(where);
    }
    if (rows.some((row) => row.url) && config.channel !== 'telegram') {
      issues.push(
        'URL buttons are supported on Telegram only in this version — set the channel to Telegram or remove them'
      );
    }
    const body = firstTextBody(config.blocks);
    if (
      body &&
      body.trim().length > 1024 &&
      config.channel !== 'telegram' &&
      rows.length > 0
    ) {
      issues.push(
        'Button prompts over 1024 characters need the Telegram channel (WhatsApp interactive limit)'
      );
    }
    return issues;
  },
  async execute(ctx, config) {
    const resolved = await resolveConversationChannel(ctx, config.channel);
    if ('error' in resolved) {
      return { status: 'fail', error: resolved.error };
    }
    const db = asDb(ctx);
    const { conversationId, channel } = resolved;
    const messageIds: string[] = [];
    let lastBody: string | null = null;

    try {
      for (const block of config.blocks ?? []) {
        const cfg = (block.config ?? {}) as Record<string, unknown>;
        // Stable across engine attempts: a retry after a partial send
        // reuses the persisted row instead of double-sending.
        const blockKey = messageBlockKey(ctx.runId, ctx.nodeId ?? 'message.send', block.id);
        if (block.blockType === 'text' && typeof cfg.text === 'string') {
          lastBody = cfg.text;
          const sent = await dispatchText({
            db,
            accountId: ctx.accountId,
            conversationId,
            channel,
            text: cfg.text,
            idempotencyKey: blockKey,
          });
          messageIds.push(sent.messageId);
        } else if (
          block.blockType === 'image' &&
          typeof cfg.mediaUrl === 'string'
        ) {
          const caption =
            typeof cfg.caption === 'string' && cfg.caption
              ? cfg.caption
              : null;
          if (caption) lastBody = caption;
          const sent = await dispatchMedia({
            db,
            accountId: ctx.accountId,
            conversationId,
            channel,
            mediaKind: 'image',
            mediaUrl: cfg.mediaUrl,
            caption,
            idempotencyKey: blockKey,
          });
          messageIds.push(sent.messageId);
        } else if (block.blockType === 'delay') {
          const seconds =
            typeof cfg.seconds === 'number' ? cfg.seconds : MAX_DELAY_SECONDS;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(seconds, MAX_DELAY_SECONDS) * 1000)
          );
        } else if (block.blockType === 'buttons') {
          const rows = buttonRowsOf([block]);
          if (rows.length === 0) continue;
          const body = lastBody ?? 'Choose an option:';
          if (channel === 'telegram') {
            const markup: TelegramInlineMarkup = {
              inline_keyboard: rows.map((row) => [
                row.url
                  ? { text: row.label, url: row.url }
                  : { text: row.label, callback_data: row.id },
              ]),
            };
            const sent = await dispatchText({
              db,
              accountId: ctx.accountId,
              conversationId,
              channel,
              text: body,
              inlineKeyboard: markup,
              idempotencyKey: blockKey,
            });
            messageIds.push(sent.messageId);
          } else {
            const sent = await dispatchInteractive({
              db,
              accountId: ctx.accountId,
              conversationId,
              channel,
              payload: {
                kind: 'buttons',
                body,
                buttons: rows
                  .filter((row) => !row.url)
                  .map((row) => ({ id: row.id, title: row.label })),
              },
              idempotencyKey: blockKey,
            });
            messageIds.push(sent.messageId);
          }
        }
      }
    } catch (error) {
      // Blocks already sent stay sent AND are keyed by a stable
      // run:node:block idempotency key, so an engine retry reuses the
      // persisted rows instead of double-sending.
      if (error instanceof ChannelSocketError) {
        throw new NodeExecutionError(error.message, true);
      }
      throw error;
    }

    return {
      status: 'ok',
      output: {
        messageIds,
        channel,
        blockCount: (config.blocks ?? []).length,
      },
    };
  },
};
