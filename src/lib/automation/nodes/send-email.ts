import { z } from 'zod';

import { ChannelSocketError, dispatchText } from '@/lib/channels/socket';
import { getEmailTemplate } from '@/lib/email/templates';
import { messageBlockKey } from '@/lib/messaging/idempotency';

import { interpolateTemplate } from '../interpolate';
import { NodeExecutionError } from '../types';
import type { NodeDefinition } from '../types';
import { resolveConversationChannel } from './channel';
import { asDb } from './db';

const sendEmailConfig = z.object({
  /** Optional template; inline subject/body fill or override it. */
  templateId: z.string().uuid().optional(),
  subject: z.string().max(500).optional(),
  text: z.string().max(100_000).optional(),
});

export const sendEmailAction: NodeDefinition<z.infer<typeof sendEmailConfig>> = {
  type: 'action.send_email',
  kind: 'action',
  label: 'Send email',
  description: 'Send an email on the contact conversation',
  category: 'communication',
  configSchema: sendEmailConfig,
  preview: 'message',
  summarize(config) {
    const subject = config.subject?.trim();
    return subject
      ? subject.length > 72
        ? `${subject.slice(0, 72)}…`
        : subject
      : 'Send email';
  },
  validate(config) {
    if (!config.templateId && !config.subject?.trim() && !config.text?.trim()) {
      return ['Set a template or a subject/body'];
    }
    return [];
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const resolved = await resolveConversationChannel(ctx, 'email');
    if ('error' in resolved) {
      return { status: 'fail', error: resolved.error };
    }
    const { conversationId } = resolved;

    // Template defaults; inline fields override. Variables resolve
    // from the run scope (contact fields + event + vars), same
    // engine as the HTTP/n8n nodes.
    let subject = config.subject?.trim() ?? '';
    let text = config.text ?? '';
    if (config.templateId) {
      const template = await getEmailTemplate(db, ctx.accountId, config.templateId);
      if (!template) {
        return { status: 'fail', error: 'email template not found' };
      }
      if (!subject) subject = template.subject;
      if (!text.trim() && template.body_text.trim()) text = template.body_text;
      // NOTE: template HTML bodies stay template-side; the node sends
      // text. HTML send is an inbox/manual path until product demand.
      void template.body_html;
    }
    if (!subject.trim() || !text.trim()) {
      return { status: 'fail', error: 'email subject and body are required' };
    }

    const { data: contact } = await db
      .from('contacts')
      .select('id, name, email, phone, company')
      .eq('id', ctx.contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const scope = {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      runId: ctx.runId,
      automationId: ctx.automationId,
      event: { type: ctx.event.eventType, payload: ctx.event.payload },
      contact: (contact as Record<string, unknown> | null) ?? {},
      ...ctx.vars,
    };

    try {
      const sent = await dispatchText({
        db,
        accountId: ctx.accountId,
        conversationId,
        channel: 'email',
        subject: interpolateTemplate(subject, scope),
        text: interpolateTemplate(text, scope),
        // Stable across engine attempts — retries reuse the row.
        idempotencyKey: messageBlockKey(ctx.runId, ctx.nodeId ?? 'action.send_email', 'email'),
      });
      return {
        status: 'ok',
        output: {
          messageId: sent.messageId,
          providerMessageId: sent.providerMessageId,
          channel: 'email',
        },
      };
    } catch (error) {
      if (error instanceof ChannelSocketError) {
        throw new NodeExecutionError(error.message, true);
      }
      throw error;
    }
  },
};
