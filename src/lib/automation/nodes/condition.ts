import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExecutionContext, NodeDefinition } from '../types';

const conditionConfig = z.object({
  subject: z.enum(['event.tag_id', 'has_tag']),
  op: z.enum(['eq', 'neq']).default('eq'),
  value: z.string().min(1),
});

function asDb(ctx: ExecutionContext): SupabaseClient {
  return ctx.db as SupabaseClient;
}

function compare(
  left: string | undefined,
  op: 'eq' | 'neq',
  right: string
): boolean {
  const eq = left === right;
  return op === 'eq' ? eq : !eq;
}

export const conditionNode: NodeDefinition<z.infer<typeof conditionConfig>> = {
  type: 'logic.condition',
  kind: 'condition',
  label: 'Condition',
  description: 'Branch on event payload or contact tags',
  category: 'logic',
  configSchema: conditionConfig,
  async execute(ctx, config) {
    let left: string | undefined;
    if (config.subject === 'event.tag_id') {
      const tagId = ctx.event.payload.tag_id;
      left = typeof tagId === 'string' ? tagId : undefined;
    } else {
      const db = asDb(ctx);
      const { data } = await db
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', ctx.contactId);
      const ids = (data ?? []).map((r) => r.tag_id as string);
      const pass =
        config.op === 'eq'
          ? ids.includes(config.value)
          : !ids.includes(config.value);
      return { status: 'branch', branch: pass ? 'true' : 'false' };
    }

    const pass = compare(left, config.op, config.value);
    return { status: 'branch', branch: pass ? 'true' : 'false' };
  },
};
