import { z } from 'zod';

import { removeContactTag } from '@/lib/contacts/tag-write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const config = z.object({
  tagId: z.string().uuid(),
});

export const removeTagAction: NodeDefinition<z.infer<typeof config>> = {
  type: 'action.remove_tag',
  kind: 'action',
  label: 'Remove tag',
  description: 'Remove a tag from the contact and emit tag_removed',
  category: 'crm',
  configSchema: config,
  summarize() {
    return 'Remove a tag';
  },
  async execute(ctx, value) {
    const db = asDb(ctx);
    const removed = await removeContactTag(db, {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      tagId: value.tagId,
    });

    if (removed) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.TAG_REMOVED,
        contactId: ctx.contactId,
        payload: { tag_id: value.tagId },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `tag_removed:${ctx.runId}:${ctx.contactId}:${value.tagId}`,
      });
    }

    return { status: 'ok', output: { removed, tagId: value.tagId } };
  },
};
