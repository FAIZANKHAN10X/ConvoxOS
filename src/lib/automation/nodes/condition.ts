import { z } from 'zod';

import { getPredicate, listPredicates } from '../predicates';
import type { NodeDefinition } from '../types';

const predicateLabels = Object.fromEntries(
  listPredicates().map((item) => [item.id, item.label])
);

const predicateIdList = listPredicates().map((item) => item.id);
const predicateEnum = z.enum(
  predicateIdList.length > 0
    ? (predicateIdList as [string, ...string[]])
    : ['has_tag']
);

const conditionConfig = z.object({
  predicate: predicateEnum.optional(),
  subject: z.string().optional(),
  op: z.enum(['eq', 'neq', 'contains']).default('eq'),
  value: z.string().optional(),
  tagId: z.string().uuid().optional(),
});

export const conditionNode: NodeDefinition<z.infer<typeof conditionConfig>> = {
  type: 'logic.condition',
  kind: 'condition',
  label: 'Condition',
  description: 'Branch Yes or No based on CRM or event state',
  category: 'logic',
  fieldLabels: {
    predicate: predicateLabels,
    op: { eq: 'is', neq: 'is not', contains: 'contains' },
  },
  configSchema: conditionConfig,
  summarize(config) {
    return config.predicate ?? config.subject ?? 'Choose a condition';
  },
  validate(config) {
    const id = config.predicate ?? config.subject;
    if (!id) return ['Choose a condition'];
    const predicate = getPredicate(id);
    if (!predicate) return [`Unknown condition "${id}"`];
    if (predicate.valueKind === 'tag' && !config.tagId && !config.value) {
      return ['Choose a tag'];
    }
    if (predicate.valueKind !== 'tag' && !config.value) {
      return ['Enter a value'];
    }
    if (!predicate.ops.includes(config.op)) {
      return [`${predicate.label} does not support ${config.op}`];
    }
    return [];
  },
  async execute(ctx, config) {
    const id = config.predicate ?? config.subject ?? 'has_tag';
    const predicate = getPredicate(id);
    if (!predicate) {
      return { status: 'fail', error: `unknown condition "${id}"` };
    }
    const pass = await predicate.evaluate(ctx, {
      op: config.op,
      value: config.value,
      tagId: config.tagId,
    });
    return {
      status: 'branch',
      branch: pass ? 'true' : 'false',
      output: { predicate: id, pass },
    };
  },
};
