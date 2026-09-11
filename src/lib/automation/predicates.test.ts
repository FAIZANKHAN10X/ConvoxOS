import { describe, expect, it } from 'vitest';

import { getPredicate } from './predicates';
import type { ExecutionContext } from './types';

function ctxWithDb(
  db: unknown,
  accountId = 'acct-1',
  contactId = 'contact-1'
): ExecutionContext {
  return {
    accountId,
    contactId,
    runId: 'run-1',
    nodeId: 'node-1',
    automationId: 'auto-1',
    versionId: 'v-1',
    event: {
      id: 'e1',
      accountId,
      eventType: 'tag_added',
      contactId,
      payload: {},
      source: 'crm',
      originRunId: null,
      causationEventId: null,
      chainDepth: 0,
      idempotencyKey: 'k',
      status: 'pending',
      attempts: 0,
      availableAt: new Date().toISOString(),
      processedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    },
    vars: {},
    now: new Date(),
    db,
  };
}

// Minimal Supabase-like chain: contacts lookup then contact_tags read.
function fakeDbWithTags(contactAccount: string | null, tagIds: string[]) {
  return {
    from: (name: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => {
        if (name === 'contacts') {
          return {
            data: contactAccount ? { id: 'contact-1' } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      };
      // contact_tags read path uses select/eq/limit then awaits data
      // via the evaluate's destructuring — emulate with a thenable.
      if (name === 'contact_tags') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: tagIds.map((tag_id) => ({ tag_id })),
                error: null,
              }),
            }),
          }),
        };
      }
      return chain;
    },
  };
}

describe('has_tag account scoping', () => {
  it('matches a tag on an in-account contact', async () => {
    const predicate = getPredicate('has_tag');
    expect(predicate).toBeDefined();
    const ok = await predicate!.evaluate(
      ctxWithDb(fakeDbWithTags('acct-1', ['tag-9'])),
      { op: 'eq', tagId: 'tag-9' }
    );
    expect(ok).toBe(true);
  });

  it('returns false for a contact from another account', async () => {
    const predicate = getPredicate('has_tag');
    const ok = await predicate!.evaluate(
      ctxWithDb(fakeDbWithTags(null, ['tag-9'])),
      { op: 'eq', tagId: 'tag-9' }
    );
    expect(ok).toBe(false);
  });

  it('neq inverts the scoped result', async () => {
    const predicate = getPredicate('has_tag');
    const ok = await predicate!.evaluate(
      ctxWithDb(fakeDbWithTags('acct-1', [])),
      { op: 'neq', tagId: 'tag-9' }
    );
    expect(ok).toBe(true);
  });
});
