# Telegram Module

Source of truth for Telegram as the first external channel plug. Based on actual repository code at `main:5cacc35` (media milestone). Every capability is classified `IMPLEMENTED / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED / NOT APPLICABLE / UNKNOWN` — `UNKNOWN` is never silently guessed.

Related: `docs/CHANNEL_ARCHITECTURE.md`, `docs/CHANNEL_MODULE.md`, `docs/CHANNEL_CONNECTIONS.md`, `ROADMAP.md`, `PROGRESS.md`.

## Purpose

Prove the **channel socket** boundary without rewriting WhatsApp. Telegram validates that an external provider can `Normalize → processNormalizedInbound → unified CRM → channel-aware Inbox` and be connected/disconnected in-product via `Settings → Channels`, keeping provider logic in `src/lib/channels/telegram/` and reusing ConvoxOS tenancy, contacts, conversations, messages, and storage only where genuinely shared.

## Current Status

Phase 4 `COMPLETE`; media milestone (inbound + outbound images/documents) shipped. General media placeholder `[media]` now only for audio/voice/video/sticker (deferred).

| Area | Status since |
|---|---|
| `telegram_config` schema + RLS | Phase 1 `040` |
| Inbound normalization + unified identity | Phase 1 |
| `messages.channel` provenance | Phase 1 `041` nullable → `042` NOT NULL |
| Text outbound + replies | Phase 2 |
| Channel-aware Inbox (`Reply via`) | Phase 2 + Phase 3 |
| Connection lifecycle (connect/validate/webhook/disconnect) | Phase 4 |
| Inbound media mirror (photo/document) + outbound image/document | Media milestone (this update) |

## Architecture

```
Telegram Bot API
   │
   ├── telegram_config (one row per account, encrypted at rest)
   ├── X-Telegram-Bot-Api-Secret-Token header verification
   ├── POST /api/telegram/webhook/[configId]  (PK lookup, never scans bot_token)
   ├── normalizeTelegramUpdate → NormalizedInbound{channel:'telegram'}
   │      + telegram/mirror.ts → chat-media/telegram/ (photo/document)
   ├── processNormalizedInbound (shared: findOrCreateContactUnified → conversation → message → bump → reopen → flows/automations/AI → webhooks)
   ├── sendTelegramText → POST bot<token>/sendMessage
   ├── sendTelegramMedia → POST bot<token>/sendPhoto|sendDocument via public chat-media URL
   ├── GET/POST/DELETE /api/telegram/config (admin write, viewer read)
   ├── POST /api/telegram/send + POST /api/telegram/send-media (agent)
   ├── src/lib/channels/telegram/api.ts + mirror.ts helpers
   └── Settings → Channels → Telegram card (telegram-config.tsx + channels-panel.tsx)
```

**No `channels` table, no `Conversation.channel`, no `ChannelFactory/Registry/Sender`, no generic plugin framework.** Conversations stay `UNIQUE(account_id, contact_id)`, channel provenance lives on `messages.channel` only.

## Connection Lifecycle

### Connect

`Settings → Channels → Telegram [Connect]` → `telegram-config.tsx:125 POST /api/telegram/config {bot_token}` → `config/route.ts:178` shape `^\d+:[A-Za-z0-9_-]{20,}` → `api.ts:84 getTelegramMe` → `encrypt(token)` + `crypto.randomBytes(32).hex` `webhookSecret` → `encrypt(secret)` → upsert `telegram_config` (one per account) `route:210` → `buildWebhookUrl` `route:10` prefers `NEXT_PUBLIC_SITE_URL` else `Origin/Host` (loopback guarded `route:52` requires env when `localhost/127.*|192.168.*|10.*`) → `api.ts:93 setTelegramWebhook {url, secret_token}` → `status connected / connected_at`. On `setWebhook` failure: `status disconnected` but row kept (`route:280` `webhook_ok:false`).

### Test

`[Test connection]` → `GET /api/telegram/config` `route:80` decrypt probe + best-effort `getMe`, never returns token. Toast with `@username`.

### Disconnect

`[Disconnect]` confirm → `DELETE /api/telegram/config` `route:312` best-effort `decrypt+deleteTelegramWebhook` (5xx swallowed `api:107`), then **hard-delete** row `route:338`. `contacts/conversations/messages` history survives (`ON DELETE CASCADE` only on `telegram_config.account_id`). Webhook `POST .../[configId]` then `404`. Idempotent `already_disconnected:true`.

### Status

`GET /api/telegram/config` returns `connected/has_token/reason/message/bot_username/bot_id/status/connected_at/webhook_url` (`route:142`). `token_corrupted` when `decrypt` fails. UI + Overview tile derive from row + live probe. Hard-delete means `404→ not connected`.

## Configuration

Per-provider table `telegram_config` `040:22`:

```
id UUID PK, account_id UUID FK accounts UNIQUE, bot_token_encrypted TEXT NOT NULL,
bot_username TEXT, bot_id BIGINT, webhook_secret_encrypted TEXT,
status TEXT CHECK(connected,disconnected) DEFAULT disconnected,
connected_at TIMESTAMPTZ, created_at/updated_at + trigger 040:55
```

- RLS `040:36` `select USING is_account_member`, `insert/update/delete USING/WITH CHECK is_account_member(account_id,'admin')`, service-role bypass for webhook.
- Index `idx_telegram_config_account`.
- `Settings → Channels` host `settings-sections.ts:24 tab channels`, `channels-panel.tsx:168` parallel fetch `whatsapp_config/ telegram_config` scoped `eq(account_id)`; `?tab=whatsapp` alias → `channels`.

## Authentication / Security

- Credentials encrypted `AES-256-GCM` via `src/lib/whatsapp/encryption.ts:37` (`ENCRYPTION_KEY` hex), GCM self-heal for legacy `send.ts:91`.
- Never returned: `GET/POST/DELETE` responses contain `bot_username/bot_id/webhook_url` only; `route.test.ts` asserts `JSON.stringify(j).not.toContain(token)`.
- Never logged: `api.ts:24 sanitizeTelegramMessage` truncates provider descriptions; `config route` never `console.log` token.
- Roles: `POST/DELETE` `requireRole('admin')` `route:164/315`, `GET` `requireRole('viewer')` (Inbox needs it), `POST /api/telegram/send` `requireRole('agent')` + `checkRateLimit('send-telegram:<userId>')`.
- Webhook auth: `POST /api/telegram/webhook/[configId]` `webhook:37` reads `x-telegram-bot-api-secret-token`, `58` decrypts `webhook_secret_encrypted`, `63` `!== header → 401`, no `bot_token` decrypt on webhook path (`webhook:80` comment).

## Inbound Pipeline

### Normalization (`src/lib/channels/telegram/normalize.ts:135`)

Pure mapper, no DB/decrypt.

| Update source | `NormalizedInbound.kind` | `text` | `mediaUrl` | `mediaType` | Verdict |
|---|---|---|---|---|---|
| `callback_query` (priority) | `interactive_reply` | `data` | — | — | IMPLEMENTED |
| `message.text` | `text` | `text` | — | — | IMPLEMENTED |
| `message.photo` (largest last) | `media` | `caption ?? [media]` | `file_id` | `image/jpeg` | IMPLEMENTED |
| `message.document` | `media` | `caption ?? [media]` | `file_id` | `mime_type ?? null` | IMPLEMENTED |
| `message.video` | `media` | `caption ?? [media]` | `file_id` | `mime_type ?? video/mp4` | IMPLEMENTED (mirror, but video deferred outbound) |
| `message.audio/voice/sticker` | `media` | `caption ?? [media]` | `file_id` | audio/ogg/image | IMPLEMENTED (placeholder inbound; outbound deferred) |
| `message.location` | `location` | `"lat,lon"` | — | — | IMPLEMENTED |
| `edited_message` / no `message` & no `callback_query` | `null` | — | — | — | NOT APPLICABLE (`webhook:114` acks ignored) |

`mediaUrl=file_id` pre-mirror; webhook `webhook/[configId]/route.ts:120` mirrors via `telegram/mirror.ts:111` (`getFile→download→ chat-media/telegram/` with `MEDIA_MAX_BYTES 16MB` guard) to durable `publicUrl`, sets `contentType=contentTypeForTelegramMime`. Caption preserved as `text`. `telegramFileName` carries `document.file_name`.

### Shared pipeline (`src/lib/inbound/processNormalizedInbound.ts:396`)

1. `findOrCreateContactUnified` `105` Telegram branch: lookup `telegram_user_id`, else insert `{phone:null, telegram_user_id/chat_id/username}`.
2. `findOrCreateConversationUnified:189` unified `UNIQUE(account_id,contact_id)`, oldest-first.
3. `conversation.created` webhook if created.
4. `reaction` short-circuit `257` — NOT reached for TG (normalizer never emits).
5. `reply_to_message_id` via `lookupInternalIdByMetaId` `270` — Telegram inbound reply chaining not wired.
6. `content_type` mapping `278`: `interactive_reply→interactive`, `media→image`, `location→location`, else `text`.
7. `isFirstInboundMessage` count before insert `288`.
8. `messages` upsert `296` `ON CONFLICT(conversation_id,message_id)` `idempotent`, `channel:'telegram'`, `reply_to_message_id`.
9. `bump_conversation_on_inbound` RPC `327`.
10. `reopenClosedConversation` `334`.
11. `flagBroadcastReplyIfAny` gated `channel==='whatsapp'` `337` — Telegram broadcasts absent.
12. `dispatchInboundToFlows:342` / `runAutomationsForTrigger:354` (all triggers, including `interactive_reply` for `callback_query`) / `dispatchInboundToAiReply:377` (non-interactive text, when no flow consumed) — **channel-agnostic, IMPLEMENTED for Telegram**.
13. `message.received` webhook `387` with `channel` + compat `whatsapp_message_id`.

## Outbound Pipeline

### Text (`src/lib/channels/telegram/send.ts:204` + `src/app/api/telegram/send/route.ts:129`)

- `sendTelegramText` — decrypt token (self-heal), `chat_id = telegram_chat_id ?? telegram_user_id`, `POST bot<token>/sendMessage {chat_id,text,reply_to_message_id?}`, `4096` limit `30`, `messages{channel:'telegram', content_type:'text', message_id:tg_<chat>_<id>, status:'sent', reply_to_message_id}`, `conversations.last_message_*`, `flow_runs paused_by_agent` via `supabaseAdmin`.
- Route — thin, validates `conversation_id|contact_id + content_text` before `findOrCreateConversation`, `requireRole('agent')` before decrypt, `checkRateLimit`.
- **IMPLEMENTED.** Graceful reply degrade if parent `tg_…` missing.

### Images + Documents (`src/lib/channels/telegram/send-media.ts:169` + `POST /api/telegram/send-media:80`)

- `sendTelegramMedia` — same tenancy/decrypt/legacy handling as text, validates `mediaUrl` + `1024` caption, resolves `reply_to_message_id` same as text, `POST bot<token>/sendPhoto {photo:mediaUrl, caption?}` for `image` vs `sendDocument {document:mediaUrl, caption?}` for `document` via public `chat-media` URL (`api.ts` not needed; direct fetch), persists `messages{channel:'telegram', content_type:image|document, media_url, media_type, content_text:caption|filename}`.
- Route — `requireRole('agent')` + `checkRateLimit`, `media_url + media_kind image|document` required, `contact_id→findOrCreateConversation` same as text.
- **IMPLEMENTED** for `image` + `document`. **NOT IMPLEMENTED** `video/audio/voice` (deferred).

### Other outbound types

- Video / audio / voice / location / interactive / templates / broadcasts / reactions / typing / edit / delete — **NOT IMPLEMENTED**. `api.ts:120` only `getMe/setWebhook/deleteWebhook/getWebhookInfo/getFile/download`; composer now allows image+document for Telegram, video/voice still blocked.

## Inbox Integration

- **Available channels:** `src/lib/inbox/conversations.ts:52 CHANNEL_ORDER ['whatsapp','telegram']`, `getAvailableContactChannels` (`phone→whatsapp`, `telegram_user_id→telegram`). IMPLEMENTED.
- **Summary/filter:** `summarizeConversationChannels(messages)` derives `channels[]/latestChannel` from `messages.channel`; `matchesChannelFilter` mixed appears in both. IMPLEMENTED (`phase-3` `27b2d9a`).
- **Reply via:** `message-thread:212 selectedChannel` per-thread state, default last inbound `channel` when both `307`, `telegramConnected` via `telegram_config status` `248`, branching `fetch /api/telegram/send vs /api/telegram/send-media vs /api/whatsapp/send` (`587` + `660` media branch). IMPLEMENTED.
- **Blocked states:** `message-composer:204 telegramBlocked=isTelegram&&!telegramConnected` banner `605`, `whatsappBlocked=isWhatsApp&&sessionExpired` (`session.ts:684eb59` isolation — Telegram never extends WA 24h). IMPLEMENTED.
- **Media:** composer `message-composer:207` image+document enabled for Telegram, video/voice still `disabled` (deferred); template/interactive remain WhatsApp-only `774`. `message-bubble.tsx:76` generic `media_url` already handles `image/document` for any `channel`.
- **Chrome:** thread/message badges `whatsapp` green / `telegram` sky, bubble footer `tg_` not exposed.

## Supported Capabilities

| Capability | Classification | Notes |
|---|---|---|
| Inbound text | IMPLEMENTED | `normalize:64` |
| Inbound location | IMPLEMENTED | `normalize:98` |
| Inbound `callback_query` → `interactive_reply` | IMPLEMENTED | `normalize:28` `tg_cb_<id>` |
| Inbound photo → image | IMPLEMENTED | `normalize` largest `photo` + `mirror:111` → `chat-media/telegram/` |
| Inbound document → document | IMPLEMENTED | `normalize document.file_id + file_name` + `mirror` |
| Inbound caption preserved as `content_text` | IMPLEMENTED | `normalize` `caption ?? [media]` |
| Inbound video/audio/voice/sticker → image/document/audio | PARTIALLY IMPLEMENTED | Normalized + mirrored, but `message-bubble` will show; outbound for these deferred |
| Text outbound | IMPLEMENTED | `send.ts:139` |
| Text + inline keyboard (callback/url) | IMPLEMENTED | `send.ts:128 reply_markup inline_keyboard` via `keyboard.ts` validation |
| Image + inline keyboard | IMPLEMENTED | `send-media:103 sendPhoto + reply_markup` |
| Document + inline keyboard | IMPLEMENTED | `send-media:103 sendDocument + reply_markup` |
| Inline keyboard outbound (callback_data 1-64B, url https, disabled) | IMPLEMENTED | `keyboard.ts:117 validate + toTelegramReplyMarkup` + `send*/route.ts` `reply_markup` JSON validation |
| Callback acknowledgement `answerCallbackQuery` | IMPLEMENTED | `api.ts:answerTelegramCallback` best-effort in `webhook:162` after `processNormalizedInbound` |
| Image outbound | IMPLEMENTED | `send-media:169 sendPhoto via chat-media URL` |
| Document outbound | IMPLEMENTED | `send-media:169 sendDocument` |
| Reply/quote outbound | IMPLEMENTED | `send.ts:102` + `send-media:102` |
| 4096 limit / 1024 caption | IMPLEMENTED | `send.ts:30` + `send-media:1024` |
| Connection lifecycle (validate/webhook/disconnect) | IMPLEMENTED | `api.ts:84 + config route` |
| Settings host | IMPLEMENTED | `channels-panel` |
| Unified contact/conversation, `messages.channel` NOT NULL | IMPLEMENTED | `041:37 042:19` |
| Inbox `Reply via` + filters (image+document for Telegram) | IMPLEMENTED | `conversations.ts` + `message-thread:660` + `composer:207` |
| Automations / Flows / AI fan-out | IMPLEMENTED | `processNormalizedInbound:342/354/377` |
| Webhook secret verification | IMPLEMENTED | `webhook:58` |
| `chat-media` reuse with `telegram/` prefix | IMPLEMENTED | `mirror:TELEGRAM_MIRROR_FOLDER telegram` |

## Unsupported Capabilities

| Capability | Classification | Reason |
|---|---|---|
| Inbound reactions (`message_reaction`) | NOT IMPLEMENTED | Telegram `message_reaction` update not handled |
| Outbound video | NOT IMPLEMENTED | Deferred after image/document proven; `send-media` rejects `video` |
| Outbound audio/voice | NOT IMPLEMENTED | Deferred; composer `voice` disabled for Telegram |
| Outbound location/templates/broadcasts/reactions/typing/edit/delete | NOT IMPLEMENTED | No `api.ts` method; composer explicitly disables |
| Inline keyboards `web_app/login_url/switch_inline_query/copy_text/pay` variants | NOT IMPLEMENTED | Explicitly rejected — `web_app` etc. would need Web App/Payments surface (deferred) |
| Outbound interactive beyond inline `callback/url` | NOT IMPLEMENTED | Future: `sendContact/sendLocation` as inline? Not needed |
| Public API `/api/v1` for Telegram | NOT IMPLEMENTED | Only private `/api/telegram/send` + `/send-media` |
| MCP `send_message` for Telegram | NOT IMPLEMENTED | WA-only |
| Read receipts / status sync | NOT IMPLEMENTED | Inbound `delivered`, outbound `sent` only |

## Database / Persistence

- `telegram_config` `040:22` one per account `UNIQUE(account_id)`, FK `accounts ON DELETE CASCADE`, `bot_token_encrypted NOT NULL`, `bot_username/bot_id/webhook_secret_encrypted/status/connected_at`, RLS viewer read / admin write, `set_updated_at` trigger. Represents connection lifecycle — **no `channels` table, no `Conversation.channel`.**
- `contacts.phone` nullable `041:37`, `telegram_user_id BIGINT UNIQUE(account_id, telegram_user_id) WHERE NOT NULL 041:58`, `telegram_chat_id/username` metadata, index `idx_contacts_telegram_chat_id`. Stable Telegram identity, phone may be null.
- `messages.channel TEXT NOT NULL CHECK(whatsapp,telegram) DEFAULT whatsapp 042:19`, indexes `idx_messages_channel / idx_messages_conversation_channel`, `content_type image|document|video|audio|text|location|interactive`, `media_url/media_type` generic (no migration — Telegram reuses same columns). Mixed threads allowed.
- `conversations` `UNIQUE(account_id, contact_id) 036`, oldest-first `findOrCreateConversationUnified:189` — unified. No schema change for media.
- `chat-media` bucket `mirror-inbound-media.ts:39` / `storage/upload-media.ts:17` `chat-media`, `MEDIA_MAX_BYTES 16MB`, `buildMediaPath`. WA uses `MIRROR_FOLDER inbound`; Telegram uses `TELEGRAM_MIRROR_FOLDER telegram` `telegram/mirror.ts:TELEGRAM_MIRROR_FOLDER` with same RLS (first segment `account-<id>`). `*.file_id` transient, persisted as `media_url` public URL.

## API Routes

| Route | Verb | Auth | Behavior | File |
|---|---|---|---|---|
| `POST /api/telegram/webhook/[configId]` | POST | `X-Telegram-Bot-Api-Secret-Token` vs `decrypt(webhook_secret)` PK lookup | `normalize → mirror file_id→chat-media/telegram/ if kind:media → processNormalizedInbound + best-effort answerCallbackQuery` via `after()` | `webhook/[configId]/route.ts:182` |
| `POST /api/telegram/send` | POST | `requireRole(agent)` + `checkRateLimit` before decrypt | `conversation_id|contact_id + content_text + reply_to_message_id + reply_markup? (inline_keyboard JSON)` → `sendTelegramText` → `200 {messageId}` (`interactive` when `reply_markup` present) | `send/route.ts:154` |
| `POST /api/telegram/send-media` | POST | `requireRole(agent)` + `checkRateLimit` | `conversation_id|contact_id + media_url + media_kind image|document (+ caption/filename) + reply_markup?` → `sendTelegramMedia` (sendPhoto/sendDocument + reply_markup) | `send-media/route.ts:98` |
| `GET /api/telegram/config` | GET | `viewer` | safe status `connected/has_token/reason/bot_username/bot_id/webhook_url` never token | `config/route.ts:348` |
| `POST /api/telegram/config` | POST | `admin` | shape validate → `getMe` → encrypt → upsert → `setWebhook` → sanitized `200` | `config/route.ts:348` |
| `DELETE /api/telegram/config` | DELETE | `admin` | best-effort `deleteWebhook` → hard-delete row | `config/route.ts:348` |

## Provider API Surface

`src/lib/channels/telegram/api.ts:168` + `src/lib/channels/telegram/mirror.ts:111` + `send.ts/send-media.ts` + `keyboard.ts:117`:

- `getTelegramMe(botToken) → {id, username, firstName}` `api:84` `GET getMe` validate
- `setTelegramWebhook({botToken,url,secretToken})` `93` `POST setWebhook`
- `deleteTelegramWebhook(botToken)` `100` best-effort (5xx swallowed)
- `getTelegramWebhookInfo(botToken)` `112` `GET getWebhookInfo`
- `getTelegramFile(botToken,fileId)` `122` `POST getFile` + `TelegramFileInfo`
- `downloadTelegramFile(botToken,filePath)` `142` `GET file/bot<token>/<file_path>` + sanitize
- `answerTelegramCallback(botToken,callbackQueryId)` `answerCallbackQuery` best-effort (webhook after)
- `sendTelegramText` (inline `send.ts:139` `sendMessage` + `reply_markup` inline_keyboard)
- `sendTelegramMedia` (`send-media.ts:103` `sendPhoto`/`sendDocument` + `reply_markup`)
- `keyboard.ts: validateTelegramInlineMarkup (Telegram 1-64b + ConvoxOS 8x8/64 safety), toTelegramReplyMarkup, TelegramInlineMarkup with callback_data/url/disabled`
- `sanitizeTelegramMessage + lowerDesc` `api:24/80`, `telegramFetch` `42` handles `401/404→400 invalid_token, 429→rate_limited retryable, 5xx→502`
- `mirrorTelegramMedia` `mirror:49` `chat-media/telegram/` with `MEDIA_MAX_BYTES` guard, `telegramMirrorObjectName` deterministic

**Not exposed:** `sendVideo/sendAudio/sendVoice` (deferred), `editMessageText/deleteMessage/sendChatAction/setMessageReaction`. WhatsApp `meta-api.ts:1057` has 16 methods by contrast.

## Tests

Established, not aspirational:

- `src/lib/channels/telegram/normalize.test.ts` 8→12 tests (text/interactive/caption-as-media, photo largest-last, document with filename, location, ignored edited_message)
- `mirror.test.ts` 4 (mime normalize, contentType mapping, object name stem/kind)
- `send.test.ts` 9 + `send-media.test.ts` 2 (image sendPhoto) + `route.test.ts` 10 + `config/route.test.ts` 18 (`401/403`, scoping, missing/invalid/valid token, safe responses, webhook ok/failure, disconnect) + `api.test.ts` 7 + `webhook/route.test.ts` 5
- `settings-sections.test.ts` 4 + `telegram-config.test.ts` 3 static never-leak guards
- WA `send 20` regression intact; full `91/920`+ passing after media (was `89/912`)

## Known Limitations

- Inbound photo/document now mirrors to `chat-media/telegram/` (image `image/jpeg`, document with original filename). Video/audio/voice/sticker still normalized + mirrored but outbound for those remains deferred — user will see `Media*Bubble` if stored, else `[media]` fallback when >16 MB.
- `chat-media` 16 MB `MEDIA_MAX_BYTES` guard skips mirror (keeps `[media]` placeholder, logs warn) — Telegram Bot API 20 MB file limit will be caught by same guard.
- Caption preserved as `content_text` (caption ?? `[media]`), not as `media caption` field — `MessageBubble` already renders `media_url` + caption below.
- Outbound image/document only (`sendPhoto`/`sendDocument` via public URL); video/audio/voice deferred — composer video/voice disabled for Telegram, template/interactive still WhatsApp-only.
- No `getWebhookInfo` surfaced in Settings beyond `webhook_url`.

## Future Candidates

Shipped next: inbound photo/document mirror + outbound image/document (this milestone). Remaining deferred until proven:

- Video/audio/voice outbound (`sendVideo`/`sendAudio`) — needs `chat-media` MIME allow-list check + duration handling.
- Reactions (in/outbound), `answerCallbackQuery`, `sendChatAction` typing.
- Inline keyboards richer than `callback_data`.
- Templates/broadcasts, public API `/api/v1` per-channel, MCP per-channel, AI per-channel tuning.

## Definition of Done

### Shipped (Phase 1-4 + media)

- `telegram_config` + `contacts` nullable phone + `telegram_user_id` unique + `messages.channel NOT NULL CHECK whatsapp|telegram` hold, RLS admin write.
- PK webhook `401/404/400/200` + `after(processNormalizedInbound)` + unified contact reuse + `Reply via` + `channel` provenance + `Settings → Channels` host + `GET/POST/DELETE /api/telegram/config` with `NEXT_PUBLIC_SITE_URL` loopback guard + hard-delete preserves history.
- **Media:** inbound `photo/document` (with caption) → `content_type image/document` + durable `media_url` (`chat-media/telegram/` public URL) + `media_type`, oversized >16 MB keeps `[media]` placeholder (warn, not throw); outbound `image/document` via `sendPhoto/sendDocument` from same `chat-media` URL + correct `content_type`; composer image/document enabled for Telegram.

### Not yet

- Video/audio/voice outbound, reactions, templates/broadcasts — deferred.

- Update docs `ROADMAP/PROGRESS/README` only after lint/typecheck/test/build green and Graphify once via `npm run graphify:update`.
