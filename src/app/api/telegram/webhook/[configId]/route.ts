import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizeTelegramUpdate } from '@/lib/channels/telegram/normalize'
import { processNormalizedInbound } from '@/lib/inbound/processNormalizedInbound'
import type { NormalizedInbound, TelegramUpdate } from '@/lib/channels/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { contentTypeForTelegramMime, mirrorTelegramMedia } from '@/lib/channels/telegram/mirror'

export const maxDuration = 60

let _adminClient: SupabaseClient | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

function isValidUUID(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const { configId } = await params

  if (!isValidUUID(configId)) {
    return NextResponse.json({ error: 'Invalid config id' }, { status: 400 })
  }

  // Authenticate via secret header — Telegram sends X-Telegram-Bot-Api-Secret-Token
  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? request.headers.get('X-Telegram-Bot-Api-Secret-Token')

  // PK lookup — deterministic, no decrypt/scan of bot tokens
  const { data: config, error } = await supabaseAdmin()
    .from('telegram_config')
    .select('id, account_id, webhook_secret_encrypted, bot_token_encrypted')
    .eq('id', configId)
    .maybeSingle()

  if (error) {
    console.error('[telegram webhook] config lookup error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!config) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Verify secret header if configured
  if (config.webhook_secret_encrypted) {
    let expectedSecret: string
    try {
      expectedSecret = decrypt(config.webhook_secret_encrypted)
    } catch {
      console.error('[telegram webhook] webhook_secret decrypt failed for', configId)
      return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
    }
    if (!headerSecret || headerSecret !== expectedSecret) {
      console.warn('[telegram webhook] invalid secret for', configId)
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
    }
  } else if (headerSecret) {
    // Secret not configured but header present — allow but log
    console.warn('[telegram webhook] unexpected secret header for config without secret', configId)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resolve account tenancy via PK config — no bot_token decrypt
  // telegram_config id → account_id is the locator; bot_token stays encrypted at rest
  const accountId: string = config.account_id
  // Fetch account owner for audit column (same pattern as whatsapp_config.user_id)
  // Use telegram_config's account owner via accounts table
  let configOwnerUserId: string | null = null
  try {
    const { data: account } = await supabaseAdmin()
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle()
    configOwnerUserId = account?.owner_user_id ?? null
  } catch {}
  if (!configOwnerUserId) {
    // Fallback: use any profile for account (should not happen)
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle()
    configOwnerUserId = profile?.user_id ?? null
  }
  if (!configOwnerUserId) {
    console.error('[telegram webhook] no owner user_id for account', accountId)
    return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
  }

  // eslint-disable-next-line prefer-const
  let normalized = normalizeTelegramUpdate({
    update: body as TelegramUpdate,
    accountId,
    configOwnerUserId,
  })

  if (!normalized) {
    // Unsupported update type (edited_message etc.) — ack 200 to avoid Telegram retry
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  // Media mirroring: Telegram file_id → chat-media/telegram/ public URL (best-effort).
  // Provider file fetch needs bot token; decrypt only for media path.
  if (normalized.kind === 'media' && normalized.mediaUrl) {
    try {
      const fileId = normalized.mediaUrl
      const rawMime = normalized.mediaType ?? null
      const rawFileName = (normalized as { telegramFileName?: string | null }).telegramFileName ?? null
      const msg = (body as TelegramUpdate).message
      const ts = msg?.date ? String(msg.date) : null
      // Decrypt bot token for file fetch (never logged)
      const botToken = decrypt(config.bot_token_encrypted)
      const storage = supabaseAdmin().storage as unknown as Parameters<typeof mirrorTelegramMedia>[0]['storage']
      const mirrored = await mirrorTelegramMedia({
        storage,
        accountId,
        botToken,
        fileId,
        providerMessageId: normalized.providerMessageId,
        mimeType: rawMime,
        fileName: rawFileName,
        messageTimestamp: ts,
      })
      if (mirrored.publicUrl) {
        // Replace file_id with durable URL so processNormalizedInbound persists it as media_url
        normalized.mediaUrl = mirrored.publicUrl
        normalized.mediaType = mirrored.contentType ?? rawMime
        // Tell shared pipeline the correct content_type (image/document/video/audio)
        ;(normalized as unknown as Record<string, unknown>).contentType = contentTypeForTelegramMime(mirrored.contentType ?? rawMime)
      } else {
        // Keep placeholder; pipeline will store text [media] without media_url
        normalized.mediaUrl = null
        normalized.mediaType = null
      }
    } catch (err) {
      console.warn('[telegram webhook] media mirror failed, keeping placeholder:', err instanceof Error ? err.message : err)
      normalized.mediaUrl = null
      normalized.mediaType = null
    }
  }

  // Preserve WA after() guarantee for serverless
  after(async () => {
    try {
      await processNormalizedInbound(normalized as NormalizedInbound & { contentType?: string })
    } catch (err) {
      console.error('[telegram webhook] processNormalizedInbound failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
