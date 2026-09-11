import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExecutionContext } from './types';

export type PredicateOp = 'eq' | 'neq' | 'contains';
export type PredicateValueKind = 'tag' | 'string' | 'enum';

export interface ConditionPredicate {
  id: string;
  label: string;
  group: 'contact' | 'event';
  valueKind: PredicateValueKind;
  enumValues?: string[];
  ops: PredicateOp[];
  evaluate(
    ctx: ExecutionContext,
    config: { op: PredicateOp; value?: string; tagId?: string }
  ): Promise<boolean> | boolean;
}

const predicates = new Map<string, ConditionPredicate>();

export function registerPredicate(predicate: ConditionPredicate): void {
  if (predicates.has(predicate.id)) {
    throw new Error(`Duplicate condition predicate "${predicate.id}"`);
  }
  predicates.set(predicate.id, predicate);
}

export function getPredicate(id: string): ConditionPredicate | undefined {
  return predicates.get(id);
}

export function listPredicates(): ConditionPredicate[] {
  return [...predicates.values()];
}

export function predicateIds(): [string, ...string[]] {
  const ids = listPredicates().map((item) => item.id);
  if (ids.length === 0) {
    throw new Error('no condition predicates registered');
  }
  return ids as [string, ...string[]];
}

function asDb(ctx: ExecutionContext): SupabaseClient {
  return ctx.db as SupabaseClient;
}

function compareString(
  left: string | undefined,
  op: PredicateOp,
  right: string
): boolean {
  const a = (left ?? '').toLowerCase();
  const b = right.toLowerCase();
  if (op === 'contains') return a.includes(b);
  const eq = a === b;
  return op === 'eq' ? eq : !eq;
}

function payloadString(ctx: ExecutionContext, key: string): string | undefined {
  const value = ctx.event.payload[key];
  return typeof value === 'string' ? value : undefined;
}

const builtins: ConditionPredicate[] = [
  {
    id: 'has_tag',
    label: 'Contact has tag',
    group: 'contact',
    valueKind: 'tag',
    ops: ['eq', 'neq'],
    async evaluate(ctx, config) {
      const tagId = config.tagId ?? config.value;
      if (!tagId) return false;
      // Account-scoped like the sibling contact predicates: the store
      // runs service-role, so an unscoped read would answer for any
      // contact id the caller guesses.
      const { data: contact } = await asDb(ctx)
        .from('contacts')
        .select('id')
        .eq('id', ctx.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contact) return false;
      const { data } = await asDb(ctx)
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', ctx.contactId)
        .limit(200);
      const ids = (data ?? []).map((row) => row.tag_id as string);
      const has = ids.includes(tagId);
      return config.op === 'neq' ? !has : has;
    },
  },
  {
    id: 'event.tag_id',
    label: 'Event tag',
    group: 'event',
    valueKind: 'tag',
    ops: ['eq', 'neq'],
    evaluate(ctx, config) {
      const tagId = config.tagId ?? config.value ?? '';
      return compareString(payloadString(ctx, 'tag_id'), config.op, tagId);
    },
  },
  {
    id: 'event.channel',
    label: 'Message channel',
    group: 'event',
    valueKind: 'enum',
    enumValues: ['whatsapp', 'telegram'],
    ops: ['eq', 'neq'],
    evaluate(ctx, config) {
      return compareString(
        payloadString(ctx, 'channel'),
        config.op,
        config.value ?? ''
      );
    },
  },
  {
    id: 'event.text',
    label: 'Message text',
    group: 'event',
    valueKind: 'string',
    ops: ['eq', 'neq', 'contains'],
    evaluate(ctx, config) {
      const text =
        payloadString(ctx, 'text') ?? payloadString(ctx, 'content_text');
      return compareString(text, config.op, config.value ?? '');
    },
  },
  {
    id: 'contact.name',
    label: 'Contact name',
    group: 'contact',
    valueKind: 'string',
    ops: ['eq', 'neq', 'contains'],
    async evaluate(ctx, config) {
      const { data } = await asDb(ctx)
        .from('contacts')
        .select('name')
        .eq('id', ctx.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      return compareString(
        (data as { name?: string } | null)?.name,
        config.op,
        config.value ?? ''
      );
    },
  },
  {
    id: 'contact.email',
    label: 'Contact email',
    group: 'contact',
    valueKind: 'string',
    ops: ['eq', 'neq', 'contains'],
    async evaluate(ctx, config) {
      const { data } = await asDb(ctx)
        .from('contacts')
        .select('email')
        .eq('id', ctx.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      return compareString(
        (data as { email?: string } | null)?.email,
        config.op,
        config.value ?? ''
      );
    },
  },
  {
    id: 'contact.phone',
    label: 'Contact phone',
    group: 'contact',
    valueKind: 'string',
    ops: ['eq', 'neq', 'contains'],
    async evaluate(ctx, config) {
      const { data } = await asDb(ctx)
        .from('contacts')
        .select('phone')
        .eq('id', ctx.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      return compareString(
        (data as { phone?: string } | null)?.phone,
        config.op,
        config.value ?? ''
      );
    },
  },
];

for (const predicate of builtins) {
  registerPredicate(predicate);
}
