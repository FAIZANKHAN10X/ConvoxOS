import { z } from 'zod';

import { updateContact, ContactWriteError, hashPatch } from '@/lib/contacts/write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const updateContactConfig = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(30).optional(),
  company: z.string().max(120).optional(),
});

export const updateContactAction: NodeDefinition<
  z.infer<typeof updateContactConfig>
> = {
  type: 'action.update_contact',
  kind: 'action',
  label: 'Update contact',
  description: 'Update the contact’s name, email, phone or company',
  category: 'crm',
  configSchema: updateContactConfig,
  summarize(config) {
    const fields = ['name', 'email', 'phone', 'company'].filter(
      (f) => config[f as keyof typeof config] !== undefined
    );
    return fields.length > 0 ? `Set ${fields.join(', ')}` : 'Update contact';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const patch: Record<string, unknown> = {};
    for (const field of ['name', 'email', 'phone', 'company'] as const) {
      if (config[field] !== undefined) patch[field] = config[field];
    }
    if (Object.keys(patch).length === 0) {
      return { status: 'fail', error: 'no fields to update' };
    }

    let result;
    try {
      result = await updateContact(db, {
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        patch,
      });
    } catch (error) {
      if (error instanceof ContactWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    if (result.changedFields.length > 0) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.CONTACT_UPDATED,
        contactId: ctx.contactId,
        payload: { fields: result.changedFields },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `contact_updated:${ctx.contactId}:${ctx.runId}:${hashPatch(patch)}`,
      });
    }

    return { status: 'ok', output: { updated: result.changedFields } };
  },
};
