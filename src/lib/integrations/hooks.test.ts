import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createAutomationHook,
  decryptHookSecret,
  findHookByTokenHash,
  generateHookToken,
  hashHookToken,
  HOOK_TOKEN_PREFIX,
  revokeAutomationHook,
} from './hooks';

function makeDb(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ op: string; table: string; payload?: unknown }> = [];
  const chain = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (payload: unknown) => {
        calls.push({ op: 'insert', table, payload });
        return b;
      },
      update: (payload: unknown) => {
        calls.push({ op: 'update', table, payload });
        return b;
      },
      delete: () => {
        calls.push({ op: 'delete', table });
        return b;
      },
      upsert: (payload: unknown) => {
        calls.push({ op: 'upsert', table, payload });
        return b;
      },
      eq: () => b,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: { id: 'hook-1' }, error: null }),
    };
    return b;
  };
  return {
    db: { from: (table: string) => chain(table) } as unknown as SupabaseClient,
    calls,
  };
}

describe('inbound hook credentials', () => {
  it('generates URL-safe bearer tokens with the hook prefix', () => {
    const token = generateHookToken();
    expect(token.startsWith(HOOK_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^whk_[A-Za-z0-9_-]+$/);
    expect(generateHookToken()).not.toBe(token);
  });

  it('hashes deterministically for lookup', () => {
    expect(hashHookToken('whk_abc')).toBe(hashHookToken('whk_abc'));
    expect(hashHookToken('whk_abc')).not.toBe(hashHookToken('whk_abd'));
  });

  it('creates a hook storing only hash + encrypted secret', async () => {
    const { db, calls } = makeDb();
    const created = await createAutomationHook(db, {
      accountId: 'acct-1',
      automationId: 'auto-1',
      createdBy: 'user-1',
    });
    expect(created.token.startsWith(HOOK_TOKEN_PREFIX)).toBe(true);
    expect(created.secret.length).toBeGreaterThan(16);
    const upsert = calls.find((c) => c.op === 'upsert');
    const payload = upsert?.payload as Record<string, unknown>;
    expect(payload.token_hash).toBe(hashHookToken(created.token));
    expect(payload.secret_enc).not.toContain(created.secret);
    expect(payload.token_enc).not.toContain(created.token);
    expect(payload.account_id).toBe('acct-1');
    expect(payload.automation_id).toBe('auto-1');
  });

  it('finds hooks by token hash and revokes by account scope', async () => {
    const row = {
      id: 'hook-1',
      account_id: 'acct-1',
      automation_id: 'auto-1',
      secret_enc: 'enc',
      is_active: true,
    };
    const { db, calls } = makeDb([row]);
    expect(await findHookByTokenHash(db, 'abc')).toEqual(row);
    await revokeAutomationHook(db, {
      accountId: 'acct-1',
      automationId: 'auto-1',
    });
    expect(calls.some((c) => c.op === 'delete')).toBe(true);
  });

  it('decryptHookSecret delegates to AES-GCM decrypt', () => {
    expect(() => decryptHookSecret('not-encrypted')).toThrow();
  });
});
