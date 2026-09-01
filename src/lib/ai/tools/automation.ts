import { z } from 'zod';
import type { ToolDefinition } from './types';
import { runAutomationById } from '@/lib/automations/engine';

export const triggerAutomationTool: ToolDefinition = {
  name: 'trigger_automation',
  description: 'Trigger an existing automation for the current contact. Use for goal after-actions like notify team.',
  permission: 'AUTOMATION',
  schema: z.object({
    automationId: z.string().uuid(),
  }),
  handler: async (args, ctx) => {
    const { automationId } = args as { automationId: string };
    if (!ctx.contactId) return { success: false, error: 'No contact in context' };
    // Thin adapter over canonical engine — verifies account ownership and is_active
    const result = await runAutomationById({ automationId, accountId: ctx.accountId, contactId: ctx.contactId, context: { ai_tool: true } as never });
    if (!result.ok) return { success: false, error: result.error ?? 'Failed to trigger automation' };
    return { success: true, data: { automationId, triggered: true } };
  },
};
