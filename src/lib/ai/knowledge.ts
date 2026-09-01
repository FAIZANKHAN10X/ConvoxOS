import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

export const KNOWLEDGE_MAX_CHARS = 250_000;
export const KNOWLEDGE_MAX_CHUNKS = Math.ceil(KNOWLEDGE_MAX_CHARS / 800); // ~312
export type KnowledgeSourceType = 'text' | 'url' | 'file';

export interface KnowledgeSource {
  id: string;
  content: string;
  sourceTitle?: string;
  sourceType?: KnowledgeSourceType;
  sourceUrl?: string | null;
  rank?: number;
}

interface MatchRow {
  id: string
  content: string
}

/**
 * (Re)build the chunks for one document. Deletes the document's
 * existing chunks, re-chunks the content, and — when the account has an
 * embeddings key — embeds each chunk. Runs under whatever client the
 * caller passes (service-role for ingest routes).
 *
 * Throws on embedding failure so the ingest route can report it; the
 * chunks are only written once embedding (if attempted) succeeds, so a
 * failed embed never leaves half-indexed rows.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = chunkText(content)

  // Replace, don't append — re-ingest must be idempotent.
  const { error: delErr } = await db
    .from('ai_knowledge_chunks')
    .delete()
    .eq('document_id', documentId)
  if (delErr) throw delErr

  if (chunks.length === 0) return

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))

  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr

  if (embedError) throw embedError

  // Update document metadata after successful ingest
  try {
    await db.from('ai_knowledge_documents').update({ char_count: content.length, chunk_count: chunks.length, status: 'ready', error_message: null }).eq('id', documentId);
  } catch {
    // non-fatal
  }
}

export function validateKnowledgeContent(content: string): { ok: boolean; error?: string } {
  if (!content || content.trim().length === 0) return { ok: false, error: 'Content is empty' };
  if (content.length > KNOWLEDGE_MAX_CHARS) return { ok: false, error: `Content too large (${content.length} chars, max ${KNOWLEDGE_MAX_CHARS})` };
  return { ok: true };
}

export function normalizeContent(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

export async function fetchUrlContent(urlStr: string): Promise<{ content: string; error?: string }> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { content: '', error: 'Invalid URL' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { content: '', error: 'Only http and https URLs are allowed' };
  // SSRF: block private networks, localhost, metadata endpoints
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '169.254.169.254' ||
    host.includes('metadata.google')
  ) {
    return { content: '', error: 'URL points to a private network' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(urlStr, { signal: controller.signal, headers: { 'User-Agent': 'ConvoxOS-KnowledgeBot/1.0' }, redirect: 'follow' });
    if (!res.ok) return { content: '', error: `Fetch failed: ${res.status}` };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('application/json')) {
      // still try to read as text
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 1_200_000) return { content: '', error: 'URL content too large (max ~1.2MB)' };
    const raw = new TextDecoder().decode(buf);
    // Extract readable text: strip tags, scripts, styles
    const withoutScripts = raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = withoutScripts.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return { content: '', error: 'No readable text found at URL' };
    return { content: text.slice(0, KNOWLEDGE_MAX_CHARS) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fetch failed';
    if (msg.includes('abort')) return { content: '', error: 'URL fetch timed out' };
    return { content: '', error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractFileText(file: File): Promise<{ content: string; error?: string }> {
  const maxBytes = 8 * 1024 * 1024; // 8MB
  if (file.size > maxBytes) return { content: '', error: `File too large (max 8MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB)` };
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  try {
    if (ext === 'pdf') {
      // @ts-expect-error — pdf-parse types are minimal
      const pdfParse = (await import(/* webpackIgnore: true */ 'pdf-parse')).default as unknown as (data: Uint8Array) => Promise<{ text: string }>;
      const data = await pdfParse(bytes);
      const text = normalizeContent(data.text);
      if (!text) return { content: '', error: 'PDF has no extractable text' };
      return { content: text.slice(0, KNOWLEDGE_MAX_CHARS) };
    } else if (ext === 'docx') {
      const mammoth = await import(/* webpackIgnore: true */ 'mammoth');
      const result = await (mammoth as unknown as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> }).extractRawText({ buffer: Buffer.from(bytes) });
      const text = normalizeContent(result.value);
      if (!text) return { content: '', error: 'DOCX has no extractable text' };
      return { content: text.slice(0, KNOWLEDGE_MAX_CHARS) };
    } else if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      const text = normalizeContent(new TextDecoder().decode(bytes));
      if (!text) return { content: '', error: 'File is empty' };
      return { content: text.slice(0, KNOWLEDGE_MAX_CHARS) };
    } else {
      return { content: '', error: `Unsupported file type .${ext} (supported: pdf, docx, txt, md, csv)` };
    }
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : 'Failed to parse file' };
  }
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, string>() // id → content, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  return Array.from(picked.values()).slice(0, k)
}

export async function retrieveKnowledgeWithSources(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 3,
): Promise<KnowledgeSource[]> {
  const contents = await retrieveKnowledge(db, accountId, config, queryText, k);
  if (contents.length === 0) return [];
  // For transparency, we need to map each chunk back to its document.
  // Since retrieveKnowledge deduped by chunk id but returned only content, we need to re-derive.
  // We do a second lookup: find chunks whose content matches the returned excerpts (bounded, so cheap).
  // For simplicity, we fetch recent chunks for the account and match by content.
  try {
    const { data: chunks } = await db.from('ai_knowledge_chunks').select('id, content, document_id').eq('account_id', accountId).in('content', contents.slice(0, k)).limit(k * 2);
    const docIds = [...new Set((chunks as Array<{ document_id: string }> | null)?.map((c) => c.document_id) ?? [])];
    const docMap = new Map<string, { title: string; sourceType: string; sourceUrl: string | null }>();
    if (docIds.length) {
      const { data: docs } = await db.from('ai_knowledge_documents').select('id, title, source_type, source_url').in('id', docIds);
      for (const d of (docs as Array<{ id: string; title: string; source_type: string; source_url: string | null }> | null) ?? []) {
        docMap.set(d.id, { title: d.title, sourceType: d.source_type, sourceUrl: d.source_url });
      }
    }
    const byContent = new Map((chunks as Array<{ content: string; document_id: string }> | null)?.map((c) => [c.content, c.document_id]) ?? []);
    return contents.map((c) => {
      const docId = byContent.get(c);
      const meta = docId ? docMap.get(docId) : undefined;
      return {
        id: docId ?? c.slice(0, 20),
        content: c,
        sourceTitle: meta?.title,
        sourceType: (meta?.sourceType as KnowledgeSourceType | undefined) ?? 'text',
        sourceUrl: meta?.sourceUrl ?? null,
        rank: undefined,
      };
    });
  } catch {
    return contents.map((c) => ({ id: c.slice(0, 20), content: c }));
  }
}
