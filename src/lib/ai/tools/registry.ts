import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition, ToolContext, ToolResult, ToolPermission } from './types';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<T extends z.ZodTypeAny>(tool: ToolDefinition<T>) {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listForPermissions(allowed: Set<ToolPermission>): ToolDefinition[] {
    return this.list().filter((t) => allowed.has(t.permission));
  }

  toOpenAITools(allowed: Set<ToolPermission>) {
    return this.listForPermissions(allowed).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema as unknown as z.ZodType, { target: 'jsonSchema7' }),
      },
    }));
  }

  toAnthropicTools(allowed: Set<ToolPermission>) {
    return this.listForPermissions(allowed).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.schema as unknown as z.ZodType, { target: 'jsonSchema7' }) as Record<string, unknown>,
    }));
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `Unknown tool: ${name}` };
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments for ${name}: ${parsed.error.message}` };
    }
    try {
      const result = await tool.handler(parsed.data, ctx);
      // Ensure we never leak raw DB exceptions
      if (!result.success && result.error && result.error.includes('PostgREST')) {
        return { success: false, error: 'Database error', retryable: true };
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool execution failed';
      if (msg.includes('PostgREST') || msg.includes('permission')) {
        return { success: false, error: 'Database error', retryable: true };
      }
      return { success: false, error: msg };
    }
  }
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry();
}
