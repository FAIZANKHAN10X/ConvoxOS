import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createAgentTools } from './tools';
import { runAgent } from './agent';
import type { AiConfig } from './types';

// Mock provider to avoid real LLM calls — we test the loop, validation, and tool execution
vi.mock('./providers/tools', async () => {
  const actual = await vi.importActual<typeof import('./providers/tools')>('./providers/tools');
  return {
    ...actual,
    generateOpenAiWithTools: vi.fn(),
    generateAnthropicWithTools: vi.fn(),
  };
});
import { generateOpenAiWithTools } from './providers/tools';

const mockedOpenAi = generateOpenAiWithTools as unknown as ReturnType<typeof vi.fn>;

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    status: 'live',
    identity: {},
    behaviour: {},
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  } as AiConfig;
}

function mockSupabase(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'c1', name: 'Alice', email: null, phone: '123', company: null }, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        } as never;
      }
      if (table === 'contact_tags') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        } as never;
      }
      if (table === 'tags') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: 't1' }, error: null }) }),
            }),
          }),
        } as never;
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }), limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new', title: 'Test' }, error: null }) }) }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      } as never;
    }),
  } as never;
}

describe('Agent tool loop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CRM mutation: update_contact then add_tag', async () => {
    mockedOpenAi
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'get_contact', args: {} }], usage: null })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: '2', name: 'update_contact', args: { email: 'a@b.com' } }], usage: null })
      .mockResolvedValueOnce({ text: 'Done', toolCalls: undefined, usage: null });

    const registry = createAgentTools();
    const supabase = mockSupabase();
    const result = await runAgent({
      config: aiConfig(),
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'update my email' }],
      registry,
      context: { accountId: 'acct', conversationId: 'conv', contactId: 'c1', supabase },
    });
    expect(result.text).toBe('Done');
    expect(result.toolCalls.length).toBe(2);
  });

  it('handoff tool stops execution', async () => {
    mockedOpenAi.mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'handoff', args: { reason: 'requested_human' } }], usage: null });
    const registry = createAgentTools();
    // Mock handoff to succeed
    const supabase = {
      from: vi.fn(() => ({
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      })),
    } as never;
    const result = await runAgent({
      config: aiConfig(),
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'human please' }],
      registry,
      context: { accountId: 'acct', conversationId: 'conv', contactId: 'c1', supabase },
    });
    expect(result.handoff).toBe(true);
  });

  it('tool failure returns structured error and allows recovery', async () => {
    mockedOpenAi
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'add_tag', args: { tagName: 'nonexistent' } }], usage: null })
      .mockResolvedValueOnce({ text: 'I could not find that tag, but I can help otherwise', toolCalls: undefined, usage: null });
    const registry = createAgentTools();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'contact_tags') {
          return { upsert: async () => ({ error: { message: 'Tag not found' } }) } as never;
        }
        if (table === 'contacts') {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'c1' }, error: null }) }) }) }) } as never;
        }
        if (table === 'tags') {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as never;
        }
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as never;
      }),
    } as never;
    const result = await runAgent({
      config: aiConfig(),
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'add tag' }],
      registry,
      context: { accountId: 'acct', contactId: 'c1', supabase },
    });
    expect(result.text).toContain('could not find');
    expect(result.toolCalls[0].result).toMatchObject({ success: false });
  });

  it('max tool turns terminates with handoff', async () => {
    mockedOpenAi.mockResolvedValue({ text: '', toolCalls: [{ id: '1', name: 'get_contact', args: {} }], usage: null });
    const registry = createAgentTools();
    const supabase = mockSupabase();
    const result = await runAgent({
      config: aiConfig(),
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'loop' }],
      registry,
      context: { accountId: 'acct', contactId: 'c1', supabase },
      maxToolTurns: 2,
    });
    expect(result.handoff).toBe(true);
    expect(result.toolCalls.length).toBe(2);
  });
});
