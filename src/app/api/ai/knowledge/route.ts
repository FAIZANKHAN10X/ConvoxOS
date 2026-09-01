import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument, fetchUrlContent, extractFileText, KNOWLEDGE_MAX_CHARS, validateKnowledgeContent, normalizeContent } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

/**
 * GET /api/ai/knowledge
 *
 * List the account's knowledge-base documents (any member).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, source_type, source_url, status, char_count, chunk_count, updated_at, created_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/knowledge GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load knowledge base' },
        { status: 500 },
      )
    }
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/knowledge  (admin+)
 *
 * Create a document, then chunk + (optionally) embed it. If indexing
 * fails the document is still saved so the admin can retry via reindex.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    // Support both JSON (text/url) and multipart (file)
    const contentType = request.headers.get('content-type') ?? ''
    let title = ''
    let content = ''
    let sourceType: 'text' | 'url' | 'file' = 'text'
    let sourceUrl: string | null = null
    let fileName: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      title = typeof form.get('title') === 'string' ? (form.get('title') as string).trim() : ''
      sourceType = 'file'
      const file = form.get('file') as File | null
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }
      fileName = file.name
      if (!title) title = file.name.replace(/\.[^/.]+$/, '') || 'Untitled'
      const parsed = await extractFileText(file)
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })
      content = parsed.content
    } else {
      const body = await request.json().catch(() => null)
      title = typeof body?.title === 'string' ? body.title.trim() : ''
      const rawType = typeof body?.source_type === 'string' ? body.source_type.trim() : 'text'
      if (['text', 'url', 'file'].includes(rawType)) sourceType = rawType as typeof sourceType
      if ((sourceType as string) === 'url') {
        sourceUrl = typeof body?.source_url === 'string' ? body.source_url.trim() : ''
        if (!sourceUrl) return NextResponse.json({ error: 'source_url is required for url source' }, { status: 400 })
        // Validate and fetch URL content server-side
        const fetched = await fetchUrlContent(sourceUrl)
        if (fetched.error) return NextResponse.json({ error: fetched.error }, { status: 400 })
        content = fetched.content
        if (!title) {
          try {
            title = new URL(sourceUrl).hostname
          } catch {
            title = sourceUrl
          }
        }
      } else {
        content = typeof body?.content === 'string' ? body.content.trim() : ''
        if (body?.source_url && typeof body.source_url === 'string') sourceUrl = body.source_url.trim() || null
      }
      if ((sourceType as string) === 'file' && !content) {
        return NextResponse.json({ error: 'file content is required' }, { status: 400 })
      }
    }

    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

    content = normalizeContent(content)
    const validation = validateKnowledgeContent(content)
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

    const { data: doc, error } = await supabase
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        title: title.slice(0, 200),
        content,
        source_type: sourceType,
        source_url: sourceUrl,
        status: 'processing',
        char_count: content.length,
        chunk_count: 0,
      })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[ai/knowledge POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save document' },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    try {
      await ingestDocument(
        supabase,
        accountId,
        { embeddingsApiKey },
        doc.id,
        content,
      )
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'indexing failed'
      console.error('[ai/knowledge POST] ingest error:', err)
      return NextResponse.json(
        {
          success: true,
          id: doc.id,
          warning: `Saved, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
        },
        { status: 200 },
      )
    }

    if (corrupt) {
      return NextResponse.json({
        success: true,
        id: doc.id,
        warning:
          'Saved with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
      })
    }
    return NextResponse.json({ success: true, id: doc.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
