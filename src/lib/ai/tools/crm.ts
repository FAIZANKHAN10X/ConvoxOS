import { z } from 'zod';
import type { ToolDefinition } from './types';
import { emitContactUpdated } from '@/lib/automation/crm-events';
import { hashPatch, updateContact } from '@/lib/contacts/write';

// Reuse existing contact/tag logic where possible, but keep handlers
// account-scoped and validated — never trust model-supplied IDs without check.

export const getContactTool: ToolDefinition = {
  name: 'get_contact',
  description: 'Get the current contact profile, tags and relevant CRM fields. Use to personalize or check what you already know.',
  permission: 'READ',
  schema: z.object({
    contactId: z.string().uuid().optional().describe('Contact ID (defaults to current conversation contact)'),
  }),
  handler: async (args, ctx) => {
    const contactId = (args as { contactId?: string }).contactId ?? ctx.contactId;
    if (!contactId) return { success: false, error: 'No contact in context' };
    const { data: contact, error } = await ctx.supabase.from('contacts').select('id, name, email, phone, company, avatar_url, created_at').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
    if (error) return { success: false, error: 'Failed to fetch contact' };
    if (!contact) return { success: false, error: 'Contact not found' };
    // Tags (contact already verified in-account above)
    const { data: contactTags } = await ctx.supabase.from('contact_tags').select('tag_id, tags(id, name, color)').eq('contact_id', contactId);
    const tags = (contactTags ?? []).map((ct: { tags: unknown }) => ct.tags).filter(Boolean);
    // Custom fields (contact already verified in-account above)
    const { data: customValues } = await ctx.supabase.from('contact_custom_values').select('custom_field_id, value, custom_fields(field_name)').eq('contact_id', contactId);
    return { success: true, data: { contact, tags, custom_fields: customValues ?? [] } };
  },
};

export const updateContactTool: ToolDefinition = {
  name: 'update_contact',
  description: 'Update allowed contact fields: name, email, phone, company. Existing non-empty values are not overwritten unless force=true.',
  permission: 'WRITE',
  schema: z.object({
    contactId: z.string().uuid().optional(),
    name: z.string().max(120).optional(),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(30).optional(),
    company: z.string().max(120).optional(),
    force: z.boolean().optional().describe('Overwrite existing non-empty values if true'),
  }),
  handler: async (args, ctx) => {
    const a = args as { contactId?: string; name?: string; email?: string; phone?: string; company?: string; force?: boolean };
    const contactId = a.contactId ?? ctx.contactId;
    if (!contactId) return { success: false, error: 'No contact in context' };
    const { data: existing, error: fetchErr } = await ctx.supabase.from('contacts').select('id, name, email, phone, company').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
    if (fetchErr) return { success: false, error: 'Failed to fetch contact' };
    if (!existing) return { success: false, error: 'Contact not found' };
    const patch: Record<string, unknown> = {};
    const fields: Array<keyof typeof a> = ['name', 'email', 'phone', 'company'];
    for (const f of fields) {
      const v = a[f];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const existingVal = (existing as Record<string, unknown>)[f];
      if (!a.force && existingVal && String(existingVal).trim() !== '' && String(existingVal).trim() !== String(v).trim()) {
        // Skip overwrite unless force
        continue;
      }
      patch[f] = String(v).trim();
    }
    if (Object.keys(patch).length === 0) return { success: false, error: 'No fields to update or all already set (use force to overwrite)' };
    try {
      const result = await updateContact(ctx.supabase, {
        accountId: ctx.accountId,
        contactId,
        patch,
      });
      if (result.changedFields.length > 0) {
        await emitContactUpdated({
          db: ctx.supabase,
          accountId: ctx.accountId,
          contactId,
          payload: { fields: result.changedFields, source: 'api' },
          idempotencyKey: `contact_updated:${contactId}:api:${hashPatch(patch)}`,
          source: 'crm',
        });
      }
    } catch {
      return { success: false, error: 'Failed to update contact' };
    }
    return { success: true, data: { updated: Object.keys(patch) } };
  },
};

export const addTagTool: ToolDefinition = {
  name: 'add_tag',
  description: 'Add a tag to the contact. Tag must belong to this account.',
  permission: 'WRITE',
  schema: z.object({
    tagId: z.string().uuid().optional(),
    tagName: z.string().max(60).optional(),
    contactId: z.string().uuid().optional(),
  }).refine((d) => d.tagId || d.tagName, { message: 'tagId or tagName required' }),
  handler: async (args, ctx) => {
    const a = args as { tagId?: string; tagName?: string; contactId?: string };
    const contactId = a.contactId ?? ctx.contactId;
    if (!contactId) return { success: false, error: 'No contact in context' };
    // Verify contact belongs to account
    const { data: contact } = await ctx.supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
    if (!contact) return { success: false, error: 'Contact not found' };
    let tagId = a.tagId;
    if (!tagId && a.tagName) {
      const { data: tag } = await ctx.supabase.from('tags').select('id').eq('account_id', ctx.accountId).eq('name', a.tagName.trim()).maybeSingle();
      if (!tag) return { success: false, error: `Tag "${a.tagName}" not found` };
      tagId = tag.id;
    }
    if (!tagId) return { success: false, error: 'Tag not found' };
    // Verify tag belongs to account (if tagId supplied)
    const { data: tagCheck } = await ctx.supabase.from('tags').select('id').eq('id', tagId).eq('account_id', ctx.accountId).maybeSingle();
    if (!tagCheck) return { success: false, error: 'Tag not found for this account' };
    // Idempotent insert
    const { error } = await ctx.supabase.from('contact_tags').upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: false });
    if (error) return { success: false, error: 'Failed to add tag' };
    return { success: true, data: { tagId } };
  },
};

export const removeTagTool: ToolDefinition = {
  name: 'remove_tag',
  description: 'Remove a tag from the contact.',
  permission: 'WRITE',
  schema: z.object({
    tagId: z.string().uuid().optional(),
    tagName: z.string().max(60).optional(),
    contactId: z.string().uuid().optional(),
  }).refine((d) => d.tagId || d.tagName, { message: 'tagId or tagName required' }),
  handler: async (args, ctx) => {
    const a = args as { tagId?: string; tagName?: string; contactId?: string };
    const contactId = a.contactId ?? ctx.contactId;
    if (!contactId) return { success: false, error: 'No contact in context' };
    // Verify contact belongs to account (mirrors add_tag)
    const { data: contact } = await ctx.supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
    if (!contact) return { success: false, error: 'Contact not found' };
    let tagId = a.tagId;
    if (!tagId && a.tagName) {
      const { data: tag } = await ctx.supabase.from('tags').select('id').eq('account_id', ctx.accountId).eq('name', a.tagName.trim()).maybeSingle();
      if (!tag) return { success: false, error: `Tag "${a.tagName}" not found` };
      tagId = tag.id;
    }
    if (!tagId) return { success: false, error: 'Tag not found' };
    // Verify tag belongs to account when the id came from the model
    const { data: tagCheck } = await ctx.supabase.from('tags').select('id').eq('id', tagId).eq('account_id', ctx.accountId).maybeSingle();
    if (!tagCheck) return { success: false, error: 'Tag not found for this account' };
    const { error } = await ctx.supabase.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', tagId);
    if (error) return { success: false, error: 'Failed to remove tag' };
    return { success: true, data: { tagId } };
  },
};

export const updateCustomFieldTool: ToolDefinition = {
  name: 'update_custom_field',
  description: 'Update a custom field value for the contact. Field must exist for this account.',
  permission: 'WRITE',
  schema: z.object({
    fieldName: z.string().min(1).max(80).optional(),
    fieldId: z.string().uuid().optional(),
    value: z.string().max(2000),
    contactId: z.string().uuid().optional(),
  }).refine((d) => d.fieldName || d.fieldId, { message: 'fieldName or fieldId required' }),
  handler: async (args, ctx) => {
    const a = args as { fieldName?: string; fieldId?: string; value: string; contactId?: string };
    const contactId = a.contactId ?? ctx.contactId;
    if (!contactId) return { success: false, error: 'No contact in context' };
    // Verify contact belongs to account before writing
    const { data: contact } = await ctx.supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
    if (!contact) return { success: false, error: 'Contact not found' };
    let fieldId = a.fieldId;
    if (!fieldId && a.fieldName) {
      const { data: field } = await ctx.supabase.from('custom_fields').select('id').eq('account_id', ctx.accountId).eq('field_name', a.fieldName.trim()).maybeSingle();
      if (!field) return { success: false, error: `Custom field "${a.fieldName}" not found` };
      fieldId = field.id;
    }
    if (!fieldId) return { success: false, error: 'Field not found' };
    // Verify field belongs to account when the id came from the model
    const { data: fieldCheck } = await ctx.supabase.from('custom_fields').select('id').eq('id', fieldId).eq('account_id', ctx.accountId).maybeSingle();
    if (!fieldCheck) return { success: false, error: 'Custom field not found for this account' };
    const { error } = await ctx.supabase.from('contact_custom_values').upsert({ contact_id: contactId, custom_field_id: fieldId, value: a.value.trim() }, { onConflict: 'contact_id,custom_field_id' });
    if (error) return { success: false, error: 'Failed to update custom field' };
    return { success: true, data: { fieldId } };
  },
};
