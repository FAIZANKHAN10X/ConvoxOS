import { describe, it, expect, vi } from 'vitest';
import { getContactTool, addTagTool, removeTagTool, updateCustomFieldTool } from './crm';

function mockSupabase(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'contacts' && overrides.contacts) return overrides.contacts as never;
      if (table === 'contact_tags' && overrides.contactTags) return overrides.contactTags as never;
      if (table === 'tags' && overrides.tags) return overrides.tags as never;
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        maybeSingle: async () => ({ data: null, error: null }),
      } as never;
    }),
  } as never;
}

describe('CRM tools', () => {
  it('get_contact validates account ownership', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      })),
    } as never;
    const res = await getContactTool.handler({ contactId: '00000000-0000-0000-0000-000000000001' }, { accountId: 'acct', supabase });
    expect(res.success).toBe(false);
  });

  it('add_tag requires tagId or tagName', async () => {
    const supabase = mockSupabase();
    const res = await addTagTool.handler({}, { accountId: 'acct', contactId: 'c1', supabase } as never);
    // Should fail validation before handler — but handler will check
    expect(res.success).toBe(false);
  });

  it('remove_tag rejects a contact from another account', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      })),
    } as never;
    const res = await removeTagTool.handler(
      { tagName: 'vip' },
      { accountId: 'acct', contactId: 'c-other', supabase } as never
    );
    expect(res).toEqual({ success: false, error: 'Contact not found' });
  });

  it('remove_tag rejects a tag from another account', async () => {
    let calls = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        calls += 1;
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'c1' }, error: null }),
                }),
              }),
            }),
          } as never;
        }
        // tags lookup by name succeeds, ownership check fails
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        } as never;
      }),
    } as never;
    const res = await removeTagTool.handler(
      { tagName: 'vip' },
      { accountId: 'acct', contactId: 'c1', supabase } as never
    );
    expect(res.success).toBe(false);
    expect(calls).toBeGreaterThan(0);
  });

  it('update_custom_field writes the real column with ownership checks', async () => {
    const upserts: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'contact_custom_values') {
          return {
            upsert: async (row: Record<string, unknown>) => {
              upserts.push(row);
              return { error: null };
            },
          } as never;
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'owner-ok' }, error: null }),
              }),
            }),
          }),
        } as never;
      }),
    } as never;
    const res = await updateCustomFieldTool.handler(
      { fieldName: 'plan', value: 'pro' },
      { accountId: 'acct', contactId: 'c1', supabase } as never
    );
    expect(res).toEqual({ success: true, data: { fieldId: 'owner-ok' } });
    // Regression: must use the real custom_field_id column, not field_id.
    expect(upserts[0]).toMatchObject({
      contact_id: 'c1',
      custom_field_id: 'owner-ok',
      value: 'pro',
    });
    expect(upserts[0]).not.toHaveProperty('field_id');
  });

  it('update_custom_field rejects a foreign contact', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      })),
    } as never;
    const res = await updateCustomFieldTool.handler(
      { fieldName: 'plan', value: 'pro' },
      { accountId: 'acct', contactId: 'c-other', supabase } as never
    );
    expect(res).toEqual({ success: false, error: 'Contact not found' });
  });
});
