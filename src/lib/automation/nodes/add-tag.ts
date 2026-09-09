import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagIfAbsent } from '@/lib/contacts/tag-write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { ExecutionContext, NodeDefinition } from '../types';

const addTagConfig = z.object({
  tagId: z.string().uuid(),
});

function asDb(ctx: ExecutionContext): SupabaseClient {
  return ctx.db as SupabaseClient;
}

export const addTagAction: NodeDefinition<z.infer<typeof addTagConfig>> = {
  type: 'action.add_tag',
  kind: 'action',
  label: 'Add tag',
  description: 'Add a tag to the contact and emit tag_added',
  category: 'crm',
  configSchema: addTagConfig,
  async execute(ctx, config) {
    const db = asDb(ctx);
    const added = await addContactTagIfAbsent(db, {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      tagId: config.tagId,
    });

    if (added) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.TAG_ADDED,
        contactId: ctx.contactId,
        payload: { tag_id: config.tagId },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `tag_added:${ctx.runId}:${ctx.contactId}:${config.tagId}`,
      });
    }

    return { status: 'ok', output: { added, tagId: config.tagId } };
  },
};
