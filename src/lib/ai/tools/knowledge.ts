import { z } from 'zod';
import type { ToolDefinition } from './types';
import { retrieveKnowledge } from '../knowledge';

export const searchKnowledgeTool: ToolDefinition = {
  name: 'search_knowledge',
  description: 'Search the knowledge base for business FAQs, policies, product info. Returns concise excerpts.',
  permission: 'READ',
  schema: z.object({
    query: z.string().min(2).max(500),
    limit: z.number().int().min(1).max(5).optional().default(3),
  }),
  handler: async (args, ctx) => {
    const { query, limit } = args as { query: string; limit?: number };
    try {
      // Retrieve via existing hybrid RAG, bounded
      const chunks = await retrieveKnowledge(ctx.supabase, ctx.accountId, { embeddingsApiKey: null } as never, query, limit ?? 3);
      // retrieveKnowledge expects a config with embeddingsApiKey, but we can pass null to force lexical
      // For now, try with empty config — it will do lexical only if no embeddings key
      // Actually we should try to load embeddings key via ctx, but we don't have config here
      // So we just return what retrieveKnowledge gave (it handles missing key gracefully)
      if (!chunks || chunks.length === 0) return { success: true, data: { results: [], message: 'No knowledge found' } };
      const results = chunks.slice(0, limit ?? 3).map((c, i) => ({ index: i + 1, content: c.slice(0, 800) }));
      return { success: true, data: { results } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Knowledge search failed' };
    }
  },
};
