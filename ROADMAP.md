# ConvoxOS Roadmap

> **Living source of truth** — where the product is going, what is done, what is next, and what “done” objectively means. See `PROGRESS.md` for execution checkpoints. Channel architecture: `docs/CHANNEL_ARCHITECTURE.md`.

## Product / Architecture Direction

**ConvoxOS is the CRM/core and acts like a socket. External channels are plugs. WhatsApp is the native core and is not rewritten into a generic provider.**

```
                         CONVOXOS CRM
                              │
              ┌───────────────┴───────────────┐
              │                               │
       WHATSAPP CORE                    CHANNEL SOCKET
              │                               │
       existing system             ┌─────────┼─────────┐
                                   │         │         │
                                Telegram  Instagram Messenger
                                  plug       plug       plug
```

- **WhatsApp is the existing/native core.** Contacts, conversations, messages, Inbox, pipelines, broadcasts, automations, AI, auth were built for WhatsApp. It stays as the stable core (Settings UI, Meta webhook, send, templates).
- **External channels are plugs on a socket**, not a rewrite of WhatsApp. Telegram is the first experimental plug (`NormalizedInbound` → `processNormalizedInbound`, `messages.channel` provenance, dedicated sender/route).
- **CRM remains the common host.** `accounts` is the tenancy boundary; `contacts`/`conversations`/`messages` stay unified where appropriate.
- **Channel-specific logic stays inside the channel module.** Provider API, token, limits, session rules never leak into a generic `ChannelSender` until proven necessary.
- **Stay boring.** No `channels` table, no `Conversation.channel`, no registry/factory/bus until a second *proven* external channel **and** in-product connection UX force it.

**Principle:** *A future channel should be installable/configurable without modifying the WhatsApp core or rewriting the CRM.*

Durable docs: [`docs/CHANNEL_ARCHITECTURE.md`](./docs/CHANNEL_ARCHITECTURE.md), [`docs/CHANNEL_MODULE.md`](./docs/CHANNEL_MODULE.md), [`docs/CHANNEL_CONNECTIONS.md`](./docs/CHANNEL_CONNECTIONS.md).

### Core CRM

`accounts`, `profiles`, `contacts`, `conversations`, `messages` (unified, `messages.channel` provenance only), `Inbox`, `auth` (`is_account_member`), `pipelines`/`deals`, `tags`/`custom_fields`, `webhooks`, `rate-limit`, `presence`, shared `processNormalizedInbound` flow/automation/AI fan-out.

### Channel modules

`whatsapp/*` (`send-message.ts`, `meta-api.ts`, `phone-utils`, `encryption`, `template-body`, `webhook`), `telegram/*` (`telegram_config` one bot per account, `normalize.ts`, `send.ts`, `webhook/[configId]`). Each owns its provider API, token encryption, and provider limits.

---

## Phase 0 — Foundation / Existing CRM

**Scope (from `README.md:1`, `supabase/migrations/001_*.sql` through `039`, `CHANGELOG.md`):** Forkable WhatsApp CRM template — shared inbox, contacts/tags/custom fields/CSV import/dedupe (`022`), pipelines/kanban, broadcasts with Meta templates (`001`, `014`), no-code automations (`006`), flows (`010`), AI reply/knowledge (`029`, `030`), realtime dashboard, team accounts `accounts`/`profiles` (`017`), RLS `is_account_member`, `chat-media`/`flow-media` storage, public API `/api/v1`, MCP server.

**Definition of Done**
- Fork → `npm install` → `supabase/migrations` replay on clean PG17 via `supabase db reset --local` passes (`migrations.yml`)
- `npm run typecheck` pass, `npm run build` pass, `whatsapp_config` `UNIQUE(account_id)` holds

---

## Phase 1 — Telegram Inbound — `COMPLETE`

**Implemented (`f005f27` + `040`/`041`/`042`):**

- `telegram_config` one bot per account (`040`: `id PK`, `account_id FK UNIQUE`, `bot_token_encrypted TEXT NOT NULL`, `bot_username`, `bot_id`, `webhook_secret_encrypted`, `status`, RLS `is_account_member` admin write, `update_updated_at` trigger)
- Webhook `POST /api/telegram/webhook/[configId]` (`maxDuration 60`) — `X-Telegram-Bot-Api-Secret-Token` header auth via `decrypt(webhook_secret_encrypted)` `timingSafeEqual`, `404` unknown, `401` bad secret, `400` malformed UUID; PK lookup `eq(id)` never scans `bot_token_encrypted` (`bot_token` never decrypted for routing)
- Normalization `src/lib/channels/telegram/normalize.ts` (`Update` → `NormalizedInbound{channel:'telegram', telegramUserId/chatId/username, providerMessageId: tg_<chat>_<id> | tg_cb_<id>, kind: text|interactive_reply|media|location|reaction}`)
- Identity `contacts.phone` nullable (`041: ALTER COLUMN phone DROP NOT NULL`), `telegram_user_id BIGINT` stable `UNIQUE(account_id, telegram_user_id) WHERE NOT NULL`, `telegram_chat_id` routing, `telegram_username` metadata; WA `idx_contacts_account_phone_normalized WHERE phone_normalized<>''` untouched
- Unified conversations (`036` `UNIQUE(account_id,contact_id)` preserved, no `Conversation.channel`)
- `messages.channel TEXT DEFAULT 'whatsapp' CHECK (whatsapp,telegram)` (`041` nullable backfill + `042 SET NOT NULL` after smoke test), `idx_messages_channel`, `idx_messages_conversation_channel`
- Shared pipeline `src/lib/inbound/processNormalizedInbound.ts` (`findOrCreateContactUnified` channel-aware, `findOrCreateConversationUnified` oldest-first, `messages` upsert `ON CONFLICT (conversation_id,message_id)` `037`, `bump_conversation_on_inbound` RPC, `reopenClosedConversation`, `flagBroadcastReplyIfAny` gated `channel==='whatsapp'`, `dispatchInboundToFlows`/`runAutomationsForTrigger`/`dispatchInboundToAiReply` ordering preserved)
- WhatsApp webhook structural delegation to shared (ordering/idempotency/flowConsumed/AI gating preserved)
- RLS `telegram_config_select` viewer / `insert/update/delete` admin, service-role webhook bypass

**Validation**
- Real Telegram `/start`, `hello`, `second` via `https://<tunnel>/api/telegram/webhook/<configId>` → hosted `uxkksrsdyweclnvzoubz` `contacts 1` `phone IS NULL` `telegram_user_id 5293051728`, `conversations 1` unified, `messages 3` all `channel='telegram'` `tg_5293051728_1/2/3`, `0 NULL` channel
- Auth probes `400`/`404`/`401`/`401`/`200` via `cloudflared`
- `npm test` 83/835, `typecheck` pass, `build` pass

**Definition of Done**
- `telegram_config` exists, `contacts`/`conversations`/`messages` schema as above, `messages.channel` `NOT NULL` `CHECK whatsapp|telegram` `DEFAULT whatsapp`
- Real Telegram inbound creates `phone IS NULL` contact, unified conversation, `channel='telegram'` message `tg_*`
- Same `telegram_user_id` reuses contact+conversation (1 contact, 1 conversation, `+1` message per send)
- `npm test` `ws`+`tg` targeted + full suite pass, `typecheck` pass, `build` pass, hosted `0 NULL` channel, `whatsapp_config`/`phone`/`conversation`/`message` uniques unchanged, `no channels table`

**Commits:** *none yet — foundation via migrations; Phase 1 hardened by `f005f27` `042`*

---

## Phase 2 — Telegram Manual Outbound — `COMPLETE` — `86fc94c`

**Implemented (`cc8c2ac` → `1a4afe1` → `86fc94c`, migrations `040`/`041`/`042` already present, no new migration):**

- **A — Sender:** `src/lib/channels/telegram/send.ts` `sendTelegramText` — `decrypt(bot_token_encrypted)` (GCM self-heal), `chat_id: telegram_chat_id ?? telegram_user_id`, `fetch https://api.telegram.org/bot<token>/sendMessage {chat_id, text, reply_to_message_id?}`, `4096` limit, `messages{channel:'telegram', message_id: tg_<chat>_<id>, status:'sent'}`, `conversations.last_message_*`, `flow_runs` pause, `SendTelegramError` `400`/`502`/`500` (`provider ok → DB fail` no retry)
- **B — Route:** `src/app/api/telegram/send/route.ts` thin `requireRole('agent')` *before* decrypt, `checkRateLimit('send-telegram:<userId>')`, `conversation_id|contact_id` + `content_text` validation before `findOrCreateConversation`, account-scoped resolution, delegate to `sendTelegramText`, `200 {messageId, telegramMessageId}` / `4xx`/`502`/`500` mapping. Tests `403 viewer`, `429`, `400`, `404`, `200`, `502` propagation.
- **C — Inbox `Reply via`:** `src/components/inbox/message-thread.tsx` explicit `selectedChannel:Channel` local/thread state (not DB), `availableChannels` from `contact.phone`/`telegram_user_id`, default last inbound `channel` when both, `telegramConnected` via `telegram_config` `eq(account_id)` (not RLS-only), `handleSend` branches `fetch /api/telegram/send` vs `/api/whatsapp/send`, optimistic `Message{channel:selectedChannel}`. `src/components/inbox/message-composer.tsx` props `selectedChannel/availableChannels/onChannelChange/telegramConnected`, selector `Reply via [WhatsApp|Telegram ▼]` when both, `Telegram not connected` / `No channel` banners, `whatsappOnlyDisabled` for media/interactive/template (Phase 2 text-only), `whatsappBlocked` only for `isWhatsApp && sessionExpired` (Telegram text never blocked by WA 24h).

**Preserved:** `send-message.ts`, `meta-api.ts`, `phone-utils`, templates/media/interactive, `131030` retry, automations/flows/AI/broadcasts untouched.

**Validation**
- `send.test.ts` 9 tests, `route.test.ts` 10 tests, `webhook`+`normalize` 10 tests, WA `send` 20 tests — all pass; full `83`/`854` pass, `typecheck` pass (after `phone` nullable UI fixes), `build` pass, Graphify `452`→`456` code `2620`→`2650` nodes

**Commits:** `cc8c2ac` Step A sender, `1a4afe1` Step B route, `86fc94c` Step C Inbox

**Status: COMPLETE**

---

## Phase 3 — Channel-Aware Inbox UX — `COMPLETE`

**Shipped** (`27b2d9a` filter, `684eb59` WhatsApp session isolation, `66c4bc0` reply-state clarification, `b032f69` checkpoint). See [`docs/phase-3-channel-aware-inbox.md`](./docs/phase-3-channel-aware-inbox.md).

---

## Phase 4 — Channel Connection Management — `COMPLETE`

**Shipped** (Steps A `f7c9d96` channels host, B `57974f5` provider + config API, C `a28baa7` Telegram Settings UI; E docs + Graphify). See [`docs/CHANNEL_CONNECTIONS.md`](./docs/CHANNEL_CONNECTIONS.md), [`docs/CHANNEL_ARCHITECTURE.md`](./docs/CHANNEL_ARCHITECTURE.md).

**Objective achieved:** Telegram is a complete plug — `Settings → Channels` aggregator (WhatsApp card `Manage`, Telegram card `Connect`/`Manage`), `GET/POST/DELETE /api/telegram/config` (admin write, viewer read, `getMe` validate, encrypted at rest, `setWebhook`/`deleteWebhook` with `NEXT_PUBLIC_SITE_URL` preferred + request-origin fallback, sanitized errors, never returns/logs token, hard-delete preserves history), connection status visible in Settings + Overview, Inbox `Telegram not connected` CTA now points to `channels`.

**Preserved:** no `channels` table, no `Conversation.channel`, no ChannelFactory/Registry/Sender, WhatsApp `whatsapp_config`/webhook/send/templates untouched; `?tab=whatsapp` legacy alias → `channels`.

**Validation:** lint 0 errors, typecheck pass, `89/912` tests, build pass (see `PROGRESS.md`).

---

### Phase 3 shipped scope (historical)

**Objective:** Evolve Inbox from *WhatsApp CRM with Telegram support* to *genuinely channel-aware CRM Inbox* — make provider identity obvious without `Conversation.channel`.

**Scope (investigate/design/implement, keep `Conversation` unified, `messages.channel` provenance):**

- Conversation list: channel badge/icon per row (last message `channel` or `contact` primary), unread/filter remains unified
- Thread header: channel pill for active conversation (e.g., `Telegram • @username` vs `WhatsApp • phone`)
- Message chrome: channel affordance where useful (avatar, bubble footer, `tg_` vs `wamid` not exposed)
- `Reply via` control: polished `Telegram`/`WhatsApp` selector, disabled states for missing `phone`/`telegram_user_id` or `telegram_config` disconnected, default last inbound
- Filtering: `WhatsApp / Telegram / All` toggle on conversation list (client-side `messages.channel` or `contact` capability, no new `Conversation.channel`)
- Availability: `contact` with one channel, both, neither; unified conversation containing both `whatsapp`+`telegram` messages — sensible default + manual override wins
- Connected state: `telegram_config.status` / `whatsapp_config.status` indicators, `Telegram not connected` empty state
- Icons/badges: `whatsapp` (green) / `telegram` (blue) — avoid clutter, reuse existing `Badge`/`DropdownMenu` patterns
- Empty/loading/error: channel-aware skeletons, `No channel available` vs `Telegram not connected`

**Non-goals:** No `Conversation.channel`, no `channels` table, no generic `ChannelSender` abstraction, no Telegram media/templates/interactive/broadcasts/automations, no AI per-channel (stay in `processNormalizedInbound` shared).

**Definition of Done**
- Inbox list shows channel identity per conversation; thread header shows `Reply via` with correct default (last inbound) and manual override persists per thread
- `whatsapp`-only, `telegram`-only, both, mixed, and `neither` states all render correctly without overlap
- `Telegram not connected` blocks Telegram send with clear CTA, `No channel` blocks all
- WhatsApp 24h `sessionExpired` only affects `isWhatsApp` (Telegram text always enabled)
- Checkpoint in `docs/phase-3-channel-aware-inbox.md`: lint 0 errors / 49 warnings, typecheck pass, `84` files / `869` tests, build pass

**Status: COMPLETE**

---

## Future Phases — `TBD` (not committed)

*Do not treat as roadmap commitments; mark `TBD — requires architectural/product decision` where evidence insufficient.*

### Telegram media/templates/interactive — `TBD`
*Requires decision:* `chat-media` 16 MB already supports TG `getFile` mirror, but `send.ts` currently `4096` text only. Need product decision on which TG capabilities to expose and whether to share `chat-media` bucket vs `telegram` prefix. No code evidence for committed scope.

### Additional channel modules (e.g., Instagram, email, SMS) — `TBD`
*Requires decision:* Telegram proved `NormalizedInbound` + `messages.channel` pattern. Next channel needs `*_config` table design (`bot_token` vs `phone_number_id`), identity column (`telegram_user_id` analogue), and product priority. Do not create `channels` table until second proven channel forces it.

### Channel connection management — `COMPLETE` (Phase 4)
Shipped: `telegram_config` now has `Settings → Channels` UI (`channels-panel.tsx` + `telegram-config.tsx`), `GET/POST/DELETE /api/telegram/config`, and Telegram `setWebhook`/`deleteWebhook` lifecycle via `src/lib/channels/telegram/api.ts`. Instagram/Messenger connect remains TBD.

### Automations/Flows/AI × channel — `TBD`
*Requires decision:* `processNormalizedInbound` already channel-aware for contact lookup, but `automations` `trigger_type`/`send` steps and `flows` `send_buttons/list` are WA-specific. Need decision on per-step `channel` field vs separate channel-specific automations.

### Broadcasts — `TBD`
*Requires decision:* `broadcasts`/`broadcast_recipients` currently `template_name` WA HSM. Telegram has no template approval; decision on `campaigns` polymorphic vs `channel='telegram'` broadcast variant.

### Production hardening — `PLANNED` (not TBD)
* `supabase/migrations` replay via `migrations.yml` already validates; hosted `042` `NOT NULL` enforced. Remaining: `cloudflared` temporary tunnel → Hostinger/Vercel deploy, `NEXT_PUBLIC_SITE_URL` placeholder `https://crm.example.com` → real domain, `ENCRYPTION_KEY` rotation story.

---

## Status Legend

- `COMPLETE` — shipped, verified, on `main`
- `NEXT` — approved next, not started
- `PLANNED` — intended but not committed
- `TBD` — requires architectural/product decision before commitment
- `BLOCKED` — missing prerequisite

## Future updates

When a meaningful milestone is completed: update `PROGRESS.md` (current/next, validation, Git checkpoint), update `ROADMAP.md` if scope/DoD changed, run `typecheck`/`test`/`build`, update Graphify when structurally warranted (`graphify extract . --code-only --force && graphify cluster-only .`), record Git checkpoint.
