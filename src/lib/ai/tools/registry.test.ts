import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './registry';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const r = new ToolRegistry();
    r.register({ name: 'test_tool', description: 'test', schema: z.object({ a: z.string() }), permission: 'READ', handler: async () => ({ success: true }) });
    expect(r.get('test_tool')?.name).toBe('test_tool');
    expect(r.list()).toHaveLength(1);
  });

  it('rejects duplicate names', () => {
    const r = new ToolRegistry();
    r.register({ name: 'dup', description: 'a', schema: z.object({}), permission: 'READ', handler: async () => ({ success: true }) });
    expect(() => r.register({ name: 'dup', description: 'b', schema: z.object({}), permission: 'READ', handler: async () => ({ success: true }) })).toThrow();
  });

  it('validates args and returns structured error', async () => {
    const r = new ToolRegistry();
    r.register({ name: 'needs_str', description: 'x', schema: z.object({ s: z.string().min(1) }), permission: 'READ', handler: async () => ({ success: true }) });
    const res = await r.execute('needs_str', { s: '' }, { accountId: 'a', supabase: {} as never });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid arguments');
  });

  it('returns unknown tool error', async () => {
    const r = new ToolRegistry();
    const res = await r.execute('nope', {}, { accountId: 'a', supabase: {} as never });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown tool');
  });

  it('filters by permission', () => {
    const r = new ToolRegistry();
    r.register({ name: 'read', description: 'r', schema: z.object({}), permission: 'READ', handler: async () => ({ success: true }) });
    r.register({ name: 'write', description: 'w', schema: z.object({}), permission: 'WRITE', handler: async () => ({ success: true }) });
    expect(r.listForPermissions(new Set(['READ']))).toHaveLength(1);
    expect(r.listForPermissions(new Set(['READ', 'WRITE']))).toHaveLength(2);
  });
});
