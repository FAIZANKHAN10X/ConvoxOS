-- 054_ai_knowledge_sources.sql — Phase 4: Knowledge source types + status + metadata

-- Add source tracking to knowledge documents
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'url', 'file')),
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS char_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;

-- Backfill existing docs
UPDATE ai_knowledge_documents SET char_count = char_length(content), chunk_count = 0 WHERE char_count = 0;
UPDATE ai_knowledge_documents SET status = 'ready' WHERE status = 'ready';

-- Index for status filtering in management UX
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_docs_account_status ON ai_knowledge_documents(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_docs_source_type ON ai_knowledge_documents(account_id, source_type);
