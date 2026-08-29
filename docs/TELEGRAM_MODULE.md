# Telegram Module

Source of truth for Telegram as the first external channel plug. Based on actual repository code at `main:252c674` (Phase 4 complete). Every capability is classified `IMPLEMENTED / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED / NOT APPLICABLE / UNKNOWN` — `UNKNOWN` is never silently guessed.

Related: `docs/CHANNEL_ARCHITECTURE.md`, `docs/CHANNEL_MODULE.md`, `docs/CHANNEL_CONNECTIONS.md`, `ROADMAP.md`, `PROGRESS.md`.

## Purpose

Prove the **channel socket** boundary without rewriting WhatsApp. Telegram validates that an external provider can `Normalize → processNormalizedInbound → unified CRM → channel-aware Inbox` and be connected/disconnected in-product via `Settings → Channels`, keeping provider logic in `src/lib/channels/telegram/` and reusing ConvoxOS tenancy, contacts, conversations, messages, and storage only where genuinely shared.

## Current Status

Phase 4 `COMPLETE`. Telegram is a product-connected plug with text-only messaging. Media is placeholder `[media]`; no outbound attachments yet.

| Area | Status since |
|---|---|
| `telegram_config` schema + RLS | Phase 1 `040` |
| Inbound normalization + unified identity | Phase 1 |
| `messages.channel` provenance | Phase 1 `041` nullable → `042` NOT NULL |
| Text outbound + replies | Phase 2 |
| Channel-aware Inbox (`Reply via`) | Phase 2 + Phase 3 |
| Connection lifecycle (connect/validate/webhook/disconnect) | Phase 4 |

## Architecture

```
Telegram Bot API
   │
   ├── telegram_config (one row per account, encrypted at rest)
   ├── X-Telegram-Bot-Api-Secret-Token header verification
   ├── POST /api/telegram/webhook/[configId]  (PK lookup, never scans bot_token)
   ├── normalizeTelegramUpdate → NormalizedInbound{channel:'telegram'}
   ├── processNormalizedInbound (shared: findOrCreateContactUnified → conversation → message → bump → reopen → flows/automations/AI → webhooks)
   ├── sendTelegramText → POST bot<token>/sendMessage
   ├── GET/POST/DELETE /api/telegram/config (admin write, viewer read)
   ├── src/lib/channels/telegram/api.ts helpers
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

| Update source | `NormalizedInbound.kind` | `text` | `providerMessageId` | Verdict |
|---|---|---|---|---|
| `callback_query` (priority) | `interactive_reply` | `data` (`replyId/replyTitle=data`) | `tg_cb_<cq.id>` | IMPLEMENTED |
| `message.text` | `text` | `text` | `tg_<chat>_<msgId>` | IMPLEMENTED |
| `message.caption` (photo/document/video with caption) | `text` | `caption` (caption masquerades as text) | same | IMPLEMENTED |
| `message.location` | `location` | `"lat,lon"` | same | IMPLEMENTED |
| `message.photo|document|video|audio|voice|sticker` without caption | `media` | `"[media]"` | PARTIALLY — placeholder, `mediaUrl/mediaType null` (`normalize:10` “mediaUrl stays null”) |
| `edited_message` / no `message` & no `callback_query` | `null` (ignored) | — | — | NOT APPLICABLE (caller acks `200 {ignored}` `webhook:114`) |

Identity always: `telegramUserId/from.id`, `telegramChatId/chat.id` (fallback `from.id` for callback), `telegramUsername`, `senderName`.

`mediaUrl/mediaType` never populated; `replyToProviderId` never set from `reply_to_message` (outbound reply exists).

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

### Other outbound types

- Media / documents / video / audio / voice / location / interactive / templates / broadcasts / reactions / typing / edit / delete — **NOT IMPLEMENTED**. `send.ts:1` header text-only; `api.ts:120` only `getMe/setWebhook/deleteWebhook/getWebhookInfo`; `api/send` rejects `4096` only; `message-composer:207` `whatsappOnlyDisabled=isTelegram` disables attach/template.

## Inbox Integration

- **Available channels:** `src/lib/inbox/conversations.ts:52 CHANNEL_ORDER ['whatsapp','telegram']`, `getAvailableContactChannels` (`phone→whatsapp`, `telegram_user_id→telegram`). IMPLEMENTED.
- **Summary/filter:** `summarizeConversationChannels(messages)` derives `channels[]/latestChannel` from `messages.channel`; `matchesChannelFilter` mixed appears in both. IMPLEMENTED (`phase-3` `27b2d9a`).
- **Reply via:** `message-thread:212 selectedChannel` per-thread state, default last inbound `channel` when both `307`, `telegramConnected` via `telegram_config status` `248`, branching `fetch /api/telegram/send vs /api/whatsapp/send` `587`. IMPLEMENTED.
- **Blocked states:** `message-composer:204 telegramBlocked=isTelegram&&!telegramConnected` banner `605`, `whatsappBlocked=isWhatsApp&&sessionExpired` (`session.ts:684eb59` isolation — Telegram never extends WA 24h). IMPLEMENTED.
- **Media disabled for Telegram:** attach/document/template disabled `702/774`. NOT IMPLEMENTED outbound media.
- **Chrome:** thread/message badges `whatsapp` green / `telegram` sky, bubble footer `tg_` not exposed.

## Supported Capabilities

| Capability | Classification | Notes |
|---|---|---|
| Inbound text | IMPLEMENTED | `normalize:64` |
| Inbound caption-as-text | IMPLEMENTED | `normalize:81` |
| Inbound location | IMPLEMENTED | `normalize:98` |
| Inbound `callback_query` → `interactive_reply` | IMPLEMENTED | `normalize:28` `tg_cb_<id>` |
| Inbound media placeholder | PARTIALLY IMPLEMENTED | `[media]` `mediaUrl null` |
| Text outbound | IMPLEMENTED | `send.ts:139` |
| Reply/quote outbound | IMPLEMENTED | `send.ts:102` |
| 4096 limit | IMPLEMENTED | `send.ts:30` |
| Connection lifecycle (validate/webhook/disconnect) | IMPLEMENTED | `api.ts:84 + config route` |
| Settings host | IMPLEMENTED | `channels-panel` |
| Unified contact/conversation, `messages.channel` NOT NULL | IMPLEMENTED | `041:37 042:19` |
| Inbox `Reply via` + filters | IMPLEMENTED | `conversations.ts` + `phase-3` |
| Automations / Flows / AI fan-out | IMPLEMENTED | `processNormalizedInbound:342/354/377` |
| Webhook secret verification | IMPLEMENTED | `webhook:58` |

## Unsupported Capabilities

| Capability | Classification | Reason |
|---|---|---|
| Inbound media file fetch / `chat-media` mirror | NOT IMPLEMENTED | `mediaUrl null` pending `getFile` pipeline |
| Inbound reactions (`message_reaction`) | NOT IMPLEMENTED | Telegram `message_reaction` update not handled |
| Outbound images | NOT IMPLEMENTED | No `sendPhoto` (next milestone: images) |
| Outbound documents | NOT IMPLEMENTED | No `sendDocument` (next milestone: documents) |
| Outbound video/audio/voice | NOT IMPLEMENTED | Scope deferred after images+docs proven |
| Outbound location/interactive/templates/broadcasts/reactions/typing/edit/delete | NOT IMPLEMENTED | No `api.ts` method; composer explicitly disables |
| Inline keyboards beyond `callback_query` data | PARTIALLY (callback only) | `data` treated as `interactive_reply`, not rich keyboard |
| Public API `/api/v1` for Telegram | NOT IMPLEMENTED | Only private `/api/telegram/send` |
| MCP `send_message` for Telegram | NOT IMPLEMENTED | WA-only |
| Read receipts / status sync | NOT IMPLEMENTED | Inbound `delivered`, outbound `sent` only |

## Database / Persistence

- `telegram_config` `040:22` one per account `UNIQUE(account_id)`, FK `accounts ON DELETE CASCADE`, `bot_token_encrypted NOT NULL`, `bot_username/bot_id/webhook_secret_encrypted/status/connected_at`, RLS viewer read / admin write, `set_updated_at` trigger. Represents connection lifecycle — **no `channels` table, no `Conversation.channel`.**
- `contacts.phone` nullable `041:37`, `telegram_user_id BIGINT UNIQUE(account_id, telegram_user_id) WHERE NOT NULL 041:58`, `telegram_chat_id/username` metadata, index `idx_contacts_telegram_chat_id`. Stable Telegram identity, phone may be null.
- `messages.channel TEXT NOT NULL CHECK(whatsapp,telegram) DEFAULT whatsapp 042:19`, indexes `idx_messages_channel / idx_messages_conversation_channel`. Mixed threads allowed.
- `conversations` `UNIQUE(account_id, contact_id) 036`, oldest-first `findOrCreateConversationUnified:189` — unified.
- `chat-media` bucket `mirror-inbound-media.ts:39` `chat-media` / `MIRROR_FOLDER inbound`, `MEDIA_MAX_BYTES`, path `buildMediaPath(accountId, file, null, inbound)`; Telegram will reuse with `telegram/` prefix (not yet).
- Future `*.file_id` is transient provider value, not persisted beyond `media_url`; `messages.media_url/media_type/content_type` already generic per `mirror-inbound-media.ts` pattern.

## API Routes

| Route | Verb | Auth | Behavior | File |
|---|---|---|---|---|
| `POST /api/telegram/webhook/[configId]` | POST | `X-Telegram-Bot-Api-Secret-Token` vs `decrypt(webhook_secret)` PK lookup | `normalize → processNormalizedInbound` via `after()` | `webhook/[configId]/route.ts:129` |
| `POST /api/telegram/send` | POST | `requireRole(agent)` + `checkRateLimit` before decrypt | `conversation_id|contact_id + content_text + reply_to_message_id` → `sendTelegramText` → `200 {messageId}` | `send/route.ts:129` |
| `GET /api/telegram/config` | GET | `viewer` | safe status `connected/has_token/reason/bot_username/bot_id/webhook_url` never token | `config/route.ts:348` |
| `POST /api/telegram/config` | POST | `admin` | shape validate → `getMe` → encrypt → upsert → `setWebhook` → sanitized `200` | `config/route.ts:348` |
| `DELETE /api/telegram/config` | DELETE | `admin` | best-effort `deleteWebhook` → hard-delete row | `config/route.ts:348` |

## Provider API Surface

`src/lib/channels/telegram/api.ts:120`:

- `getTelegramMe(botToken) → {id, username, firstName}` `84` `GET getMe` validate
- `setTelegramWebhook({botToken,url,secretToken})` `93` `POST setWebhook`
- `deleteTelegramWebhook(botToken)` `100` best-effort (5xx swallowed)
- `getTelegramWebhookInfo(botToken)` `112` `GET getWebhookInfo`
- `sanitizeTelegramMessage + lowerDesc` `24/80`, `telegramFetch` `42` handles `401/404→400 invalid_token, 429→rate_limited retryable, 5xx→502`

**Not exposed:** `sendMessage` (inline in `send.ts`), `sendPhoto/sendDocument/sendVideo/sendAudio/sendVoice/getFile/downloadFile/editMessageText/deleteMessage/sendChatAction/setMessageReaction/answerCallbackQuery`. WhatsApp `meta-api.ts:1057` has 16 methods by contrast.

## Tests

Established, not aspirational:

- `src/lib/channels/telegram/normalize.test.ts` 10 tests (text/interactive/media caption/location)
- `send.test.ts` 9 + `route.test.ts` 10 (text outbound), `webhook/route.test.ts` 10 (auth/normalize), `api.test.ts` 7 (sanitization), `config/route.test.ts` 18 (`401/403`, scoping, missing/invalid/valid token, safe responses, webhook ok/failure, disconnect)
- `settings-sections.test.ts` 4 + `telegram-config.test.ts` 3 static never-leak guards
- WA `send 20` regression intact; full `89/912` passing after Phase 4

## Known Limitations

- Inbound photo/document/video/audio/voice/sticker without caption renders as `[media]` text (`kind:media` but `mediaUrl null`).
- Caption-bearing media loses original file — only caption text stored.
- 20 MB per Bot API `getFile` limit (external fact) not yet enforced locally.
- `chat-media` 16 MB bucket limit (`MEDIA_MAX_BYTES`) will silently keep proxy URL when exceeded (`mirrorInboundMedia:171`).
- Outbound media disabled in composer (`whatsappOnlyDisabled=isTelegram`) even though `message-bubble.tsx:76` already handles generic `media_url` for `content_type image/video/audio/document`.
- No `getWebhookInfo` surfaced in Settings beyond `webhook_url`.

## Future Candidates

**Approved next:** Telegram media/attachments — inbound images+documents download + `chat-media` `telegram/` mirror, outbound images+documents (voice/audio/video deferred until pipeline proven).

Deferred: reactions (in/outbound), inline keyboards richer than `callback_data`, `answerCallbackQuery`, `sendChatAction`, templates/broadcasts, public API/MCP per-channel, AI per-channel tuning.

## Definition of Done

### Shipped (Phase 1-4)

- `telegram_config` + `contacts` nullable phone + `telegram_user_id` unique + `messages.channel NOT NULL CHECK whatsapp|telegram` hold, RLS admin write.
- PK webhook `401/404/400/200` + `after(processNormalizedInbound)` + unified contact reuse + `Reply via` + `channel` provenance + `Settings → Channels` host + `GET/POST/DELETE /api/telegram/config` with `NEXT_PUBLIC_SITE_URL` loopback guard + hard-delete preserves history.

### Not yet (media milestone DoD)

- Inbound `photo/document` → durable `media_url` (public URL from `chat-media` `telegram/<account>/<id>` ) + correct `content_type/media_type`, renders in `MessageBubble` (`MediaImageBubble/MediaDocumentBubble`) and not as `[media]`; oversized (>16 MB) keeps proxy or fails with logged warn, not throw.
- Outbound agent upload `image/document` → `POST bot<token>/sendPhoto|sendDocument` + `messages` row `content_type` accordingly + composer attach enabled for Telegram when connected; viewer never blocked.
- Update docs `ROADMAP/PROGRESS/README` only after lint/typecheck/test/build green and Graphify once via `npm run graphify:update`.
