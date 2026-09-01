import { z } from 'zod';

export type ToolPermission = 'READ' | 'WRITE' | 'MESSAGE' | 'AUTOMATION' | 'HANDOFF';

export interface ToolContext {
  accountId: string;
  conversationId?: string;
  contactId?: string;
  // Service-role client for writes that need to bypass RLS where appropriate,
  // but handlers must still validate account ownership.
  supabase: import('@supabase/supabase-js').SupabaseClient;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  retryable?: boolean;
}

export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  permission: ToolPermission;
  handler: (args: z.infer<T>, ctx: ToolContext) => Promise<ToolResult>;
}
