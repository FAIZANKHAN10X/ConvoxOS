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

const conditionPredicateItem = z.object({
  predicate: z.string(),
  op: z.enum(['eq', 'neq', 'contains']).default('eq'),
  value: z.string().optional(),
  tagId: z.string().uuid().optional(),
});

export type ConditionPredicateItem = z.infer<typeof conditionPredicateItem>;

const conditionConfig = z.object({
  predicate: predicateEnum.optional(),
  subject: z.string().optional(),
  op: z.enum(['eq', 'neq', 'contains']).default('eq'),
  value: z.string().optional(),
  tagId: z.string().uuid().optional(),
  mode: z.enum(['all', 'any']).default('all'),
  predicates: z.array(conditionPredicateItem).optional(),
});

export const conditionNode: NodeDefinition<z.infer<typeof conditionConfig>> = {
  type: 'logic.condition',
  kind: 'condition',
  label: 'Condition',
  description: 'Branch Yes or No',
  category: 'logic',
  fieldLabels: {
    predicate: predicateLabels,
    op: { eq: 'is', neq: 'is not', contains: 'contains' },
    mode: { all: 'All of these', any: 'Any of these' },
  },
  fieldWhen: {
    tagId: { field: 'predicate', values: ['has_tag', 'event.tag_id'] },
    value: {
      field: 'predicate',
      values: [
        'event.text',
        'event.channel',
        'contact.name',
        'contact.email',
        'contact.phone',
      ],
    },
  },
  configSchema: conditionConfig,
  summarize(config) {
    if (config.predicates && config.predicates.length > 0) {
      const labels = config.predicates.map((item) => {
        const predicate = getPredicate(item.predicate);
        return predicate ? predicate.label : item.predicate;
      });
      const head = labels.slice(0, 2).join(', ');
      const more = labels.length > 2 ? ` +${labels.length - 2}` : '';
      return `${config.mode === 'any' ? 'Any' : 'All'}: ${head}${more}`;
    }
    return config.predicate ?? config.subject ?? 'Choose a condition';
  },
  validate(config) {
    if (config.predicates && config.predicates.length > 0) {
      const issues: string[] = [];
      config.predicates.forEach((item, index) => {
        for (const message of validatePredicateItem(item)) {
          issues.push(`condition ${index + 1}: ${message}`);
        }
      });
      return issues;
    }
    return validatePredicateItem({
      predicate: config.predicate ?? config.subject,
      op: config.op,
      value: config.value,
      tagId: config.tagId,
    });
  },
  async execute(ctx, config) {
    const items =
      config.predicates && config.predicates.length > 0
        ? config.predicates.map((item) => ({
            predicate: item.predicate,
            op: item.op,
            value: item.value,
            tagId: item.tagId,
          }))
        : [
            {
              predicate: config.predicate ?? config.subject ?? 'has_tag',
              op: config.op,
              value: config.value,
              tagId: config.tagId,
            },
          ];
    const results: boolean[] = [];
    for (const item of items) {
      const predicate = getPredicate(item.predicate);
      if (!predicate) {
        return { status: 'fail', error: `unknown condition "${item.predicate}"` };
      }
      results.push(
        await predicate.evaluate(ctx, {
          op: item.op,
          value: item.value,
          tagId: item.tagId,
        })
      );
    }
    const pass =
      config.mode === 'any'
        ? results.some(Boolean)
        : results.every(Boolean);
    if (items.length === 1) {
      return {
        status: 'branch',
        branch: pass ? 'true' : 'false',
        output: { predicate: items[0].predicate, pass },
      };
    }
    return {
      status: 'branch',
      branch: pass ? 'true' : 'false',
      output: { pass, mode: config.mode, results },
    };
  },
};

function validatePredicateItem(item: {
  predicate?: string;
  op: 'eq' | 'neq' | 'contains';
  value?: string;
  tagId?: string;
}): string[] {
  const id = item.predicate;
  if (!id) return ['Choose a condition'];
  const predicate = getPredicate(id);
  if (!predicate) return [`Unknown condition "${id}"`];
  if (predicate.valueKind === 'tag' && !item.tagId && !item.value) {
    return ['Choose a tag'];
  }
  if (predicate.valueKind !== 'tag' && !item.value) {
    return ['Enter a value'];
  }
  if (!predicate.ops.includes(item.op)) {
    return [`${predicate.label} does not support ${item.op}`];
  }
  return [];
}
