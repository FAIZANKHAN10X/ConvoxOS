import { describe, it, expect, vi } from 'vitest';
import { getContactTool, addTagTool } from './crm';

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
});
