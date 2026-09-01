import { describe, it, expect } from 'vitest';
import { validateKnowledgeContent, normalizeContent, KNOWLEDGE_MAX_CHARS } from './knowledge';
import { chunkText } from './chunk';

describe('Phase 4 - Knowledge ingestion', () => {
  it('validates empty content', () => {
    expect(validateKnowledgeContent('')).toEqual({ ok: false, error: 'Content is empty' });
    expect(validateKnowledgeContent('   ')).toEqual({ ok: false, error: 'Content is empty' });
  });

  it('validates max chars', () => {
    const big = 'a'.repeat(KNOWLEDGE_MAX_CHARS + 1);
    expect(validateKnowledgeContent(big).ok).toBe(false);
    expect(validateKnowledgeContent('a'.repeat(100)).ok).toBe(true);
  });

  it('normalizes content', () => {
    expect(normalizeContent('  hello \r\n world \u0000 ')).toBe('hello \n world');
  });

  it('chunks deterministically and bounded', () => {
    const text = 'para1\n\npara2\n\n' + 'x'.repeat(2000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
    // Deterministic
    expect(chunkText(text)).toEqual(chunks);
  });

  it('chunk count bounded by MAX', () => {
    const big = 'a '.repeat(KNOWLEDGE_MAX_CHARS);
    const chunks = chunkText(big.slice(0, KNOWLEDGE_MAX_CHARS));
    expect(chunks.length).toBeLessThanOrEqual(Math.ceil(KNOWLEDGE_MAX_CHARS / 800));
  });
});
