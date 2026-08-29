# ConvoxOS Progress

> **Living checkpoint** — where we are, what is done, what is next, and how to verify it. First place to look for `Where are we?` See `ROADMAP.md` for product direction and phase Definition of Done.

## Current State

- **Branch:** `main`
- **HEAD:** `86fc94c` `feat(telegram): Step C — Inbox channel selection`
- **Current completed phase:** Phase 2 — Telegram Manual Outbound (`86fc94c`)
- **Next phase:** Phase 3 — Channel-Aware Inbox UX (`NEXT`)
- **Overall status:** Phase 1 inbound + Phase 2 outbound text shipped and verified; Inbox `Reply via` explicit but broader channel-aware UX remains next.

*Verified `2026-08-29` against `git log --oneline -1` `86fc94c` and `supabase db push --linked` `040`/`041`/`042` applied to `uxkksrsdyweclnvzoubz`.*

## Completed Phases

### Phase 0 — Foundation / Existing CRM — `COMPLETE`

- **Summary:** Forkable WhatsApp CRM — shared inbox, `contacts`/`conversations`/`messages` (`022` phone dedupe, `036` conversation dedup), `pipelines`/`deals`, `broadcasts`/`message_templates` (`014` WA HSM), `automations` (`006`), `flows` (`010`), AI reply/knowledge (`029`, `030`), `chat-media`/`flow-media`, `accounts`/`profiles` `is_account_member` (`017`), RLS, `public API`/`MCP`.
- **Validation:** `supabase/migrations` replay on clean PG17 via `migrations.yml` (`db reset --local`), `typecheck`/`build` pass.

### Phase 1 — Telegram Inbound — `COMPLETE`

- **Summary:** `telegram_config` one bot per account (`040`), webhook `POST /api/telegram/webhook/[configId]` PK `id` + `X-Telegram-Bot-Api-Secret-Token` (`decrypt(webhook_secret)`), never scans `bot_token`, normalization `telegram/normalize.ts` (`Update` → `NormalizedInbound`), identity `telegram_user_id` stable (`041` `UNIQUE(account_id, telegram_user_id)`), `telegram_chat_id` routing, `phone` nullable, `messages.channel` (`041` nullable `DEFAULT whatsapp` → `042 SET NOT NULL` after smoke test), shared `processNormalizedInbound` (unified `account/contact` → `conversation` `UNIQUE(account_id,contact_id)` → `messages` `ON CONFLICT (conversation_id,message_id)` → `bump_conversation_on_inbound` → `reopen` → `flows/automations/AI` ordering), WA webhook delegation.
- **Important commits/migrations:** `040_telegram_config.sql`, `041_channel_provenance_nullable.sql`, `042_channel_not_null_enforce.sql` + `f005f27` hardening (`042`), inbound code `src/lib/channels/telegram/normalize.ts`, `src/lib/inbound/processNormalizedInbound.ts`, `src/app/api/telegram/webhook/[configId]/route.ts`
- **Validation:** Real Telegram `/start`, `hello`, `second` via `cloudflared https://<tunnel>/api/telegram/webhook/<configId>` → hosted `contacts 1` `phone IS NULL` `telegram_user_id 5293051728` `Fznmco`, `conversations 1` unified `2e46d6d5...`, `messages 3` all `channel='telegram'` `tg_5293051728_1/2/3` `0 NULL`; auth `400`/`404`/`401`/`401`/`200`; `npm test` `ws`+`tg` targeted + full suite pass, `typecheck` pass, `build` pass; hosted `0 NULL` channel, WA uniques unchanged, `no channels` table
- **Graphify:** `040` → `443 code 2589 nodes`, `041` → `444 code 2590 nodes`, `042` `452 code 2626 nodes` before `042` enforcement — synchronized.

### Phase 2 — Telegram Manual Outbound — `COMPLETE` — `86fc94c`

- **Summary:**
  - *Step A* `cc8c2ac` — `src/lib/channels/telegram/send.ts` `sendTelegramText` (decrypt `bot_token_encrypted` GCM self-heal, `chat_id: telegram_chat_id ?? telegram_user_id`, `POST https://api.telegram.org/bot<token>/sendMessage {chat_id, text, reply_to_message_id?}`, `4096` limit, `messages{channel:'telegram', message_id: tg_<chat>_<id>, status:'sent'}`, `conversations.last_message_*`, `flow_runs` pause, `SendTelegramError` `400`/`502`/`500`)
  - *Step B* `1a4afe1` — `src/app/api/telegram/send/route.ts` thin `requireRole('agent')` before decrypt, `checkRateLimit('send-telegram:<userId>')`, `conversation_id|contact_id` + `content_text` validation before `findOrCreateConversation`, account-scoped resolution, delegate to `sendTelegramText`, `200 {messageId, telegramMessageId}` / `4xx`/`502`/`500`
  - *Step C* `86fc94c` — `src/components/inbox/message-thread.tsx` explicit `selectedChannel` local/thread state, `availableChannels` from `contact.phone`/`telegram_user_id`, default last inbound `channel`, `telegramConnected` via `telegram_config` `eq(account_id)` (not RLS-only), `handleSend` branching `fetch /api/telegram/send` vs `/api/whatsapp/send`, optimistic `Message{channel}`; `src/components/inbox/message-composer.tsx` `Reply via [WhatsApp|Telegram ▼]` when both, `Telegram not connected`/`No channel` banners, `whatsappOnlyDisabled` for media/interactive/template (Phase 2 text-only), `whatsappBlocked` only for `isWhatsApp && sessionExpired` (Telegram text never blocked)
- **Important commits:** `cc8c2ac` Step A sender, `1a4afe1` Step B route, `86fc94c` Step C Inbox (plus nullable-phone UI fixes `src/types`, `contact-sidebar`, `message-thread`, `deal-card`, `use-broadcast-sending`, `api/v1/conversations`)
- **Validation:** `send.test.ts` 9 tests, `route.test.ts` 10 tests, `webhook`/`normalize` 10 tests, WA `send` 20 tests — all pass; full `npm test` 2× verified `83 files 854 tests` / `854 tests`; `npm run typecheck` pass (after `phone` nullable fixes); `npm run build` pass (`/api/telegram/send` and `/api/telegram/webhook/[configId]` listed); Graphify `454`→`456 code` `2636`→`2650` nodes `7137`→`7175` edges `151`→`137` communities after `extract --code-only --force` + `cluster-only`; hosted `041`+`042` `messages.channel` `NOT NULL` `DEFAULT whatsapp` `CHECK whatsapp|telegram` `0 NULL`, real Telegram `hello`/`second` reuse still `1 contact` `1 conversation` `3 messages` `channel telegram`.
- **Graphify:** Updated after Step A (`454/2636/7137/151`) and after Step C (`456/2650/7175/137`); Step B deferred per workflow (2 files below threshold).

## Current Phase — Phase 3 — Channel-Aware Inbox UX — `NEXT`

- **Objective:** Evolve Inbox from *WhatsApp CRM with Telegram support* to *genuinely channel-aware CRM Inbox* — provider identity obvious without `Conversation.channel`.
- **Scope:** Conversation list channel badge/icon, thread header channel pill, message chrome where useful, polished `Reply via` control, `WhatsApp/Telegram/All` filter, availability (`phone` vs `telegram_user_id`), `connected/disconnected` state, `telegram_username` display, unified conversation containing both providers, sensible icons/badges, empty/loading/error states, no clutter.
- **Non-goals:** No `Conversation.channel`, no `channels` table, no generic `ChannelSender`/registry/bus, no Telegram media/templates/interactive/broadcasts/automations/AI per-channel (stay in `processNormalizedInbound` shared), no microservice rewrite.
- **Starting point:** `86fc94c` Inbox `Reply via` explicit local state already shipped; `messages.channel` provenance exists; `contacts` tri-modal (`phone`/`telegram_user_id`/both) verified.
- **Definition of Done**
  - List shows channel identity per conversation; header shows `Reply via` with correct default (last inbound) and manual override persists per thread
  - `whatsapp`-only, `telegram`-only, both, mixed, and `neither` states render without overlap
  - `Telegram not connected` blocks Telegram send with clear CTA, `No channel` blocks all
  - `sessionExpired` only affects `isWhatsApp` (Telegram text always enabled)
  - `npm test` `83/854` pass, `typecheck` pass, `build` pass, manual WA+TG click-through, Graphify `message-thread`/`composer` → `telegram/send` edge verified

## Validation Baseline

*Verified `2026-08-29` after `86fc94c` on `main`:*

- `npm test` → `83 files / 854 tests passing` (7.44s)
- `npm run typecheck` → `pass` (after 7 nullable-phone patches)
- `npm run build` → `pass` (`ƒ /api/telegram/send`, `ƒ /api/telegram/webhook/[configId]` present)
- `npm run lint` → `187 problems (136 errors, 51 warnings)` — 1 new `Unexpected any` in `src/lib/channels/telegram/send.ts` (`as any` for `insert` row, same pattern as WA `send-message.ts` `as any` for `channel`), pre-existing 135 remain
- Graphify → `456 code files / 2650 nodes / 7175 edges / 137 communities` (`graphify-out/graph.json` `3.5M`, `GRAPH_REPORT.md` `28K`, `graph.html` `2.7M`, `manifest.json`)
- Known non-blocking: `lit` 135→136 `any`, `/tmp` webhook secret files `600` (never committed), `cloudflared` temporary tunnel `trycloudflare.com` not in repo

## Git Checkpoints

- **Phase 1 checkpoint:** `f005f27` `feat: add Telegram inbound channel architecture` — `040`/`041`/`042` + `channels/telegram/normalize` + `inbound/processNormalizedInbound` + `whatsapp/webhook` delegation + `phone` nullable — pushed to `origin/main` (`https://github.com/FAIZANKHAN10X/ConvoxOS.git`) via `git push origin main` + tag `phase1-telegram-inbound` (not pushed)
- **Phase 2 checkpoint:** `cc8c2ac` Step A sender, `1a4afe1` Step B route, `86fc94c` Step C Inbox — all on `main`, pushed as `f005f27..86fc94c` `main -> main` to `ConvoxOS` (no `42` yet at that push, `042` later committed as part of `f005f27` hardening and `86fc94c` includes `042` already)
- Current `main` `86fc94c` — `git status --short` clean except `?? .opencode/`, `?? graphify-out/`, `?? supabase/.temp/` (generated/runtime, ignored for commit)

## Working Rules

### Graphify
- Use strategically to locate files/dependencies and avoid dumping large source trees into context
- Don't regenerate after trivial edits; update after meaningful structural/call-graph changes (new files, import changes, Phase complete)
- Run `graphify extract . --code-only --force` then `graphify cluster-only .`; remove obsolete `graphify-out/.graphify_*` temps, preserve dated `graphify-out/2026-*` backups per `backup_if_protected` (do not leave duplicate `graph.json` outside `graphify-out/`)
- Verify graph after major milestones (`telegram/webhook → processNormalizedInbound`, `message-thread → telegram/send`)

### Git
- Meaningful milestone → narrow tests → broader regression → report → explicit approval → commit → report hash → explicit approval → push
- Commit only approved Phase files (e.g., `src/lib/channels/telegram/send.ts` + `send.test.ts` for Step A); never include `.opencode/`, `graphify-out/`, `supabase/.temp/`, `.env`, secrets, Cloudflare config, `042` before verification
- Push only with explicit `git push origin main` approval; tag only when requested (`phase1-telegram-inbound`)

### Scope
- Don't expand phases without approval; don't create `channels` table/`Conversation.channel`/`ChannelSender`/registry/bus/microservice because multi-channel sounds scalable
- Preserve WhatsApp behavior (`send-message.ts`, `meta-api.ts`, `phoneVariants` `131030`, 24h window, templates/media/interactive) — Telegram additive
- Prefer boring explicit branching at `MessageThread` (`if telegram → /api/telegram/send else /api/whatsapp/send`) over abstraction

## Status Legend

- `COMPLETE` — shipped, verified, on `main`
- `NEXT` — approved next, not started
- `PLANNED` — intended but not committed
- `TBD` — requires architectural/product decision
- `BLOCKED` — missing prerequisite

## Future updates

Whenever a meaningful milestone is completed:

1. update `PROGRESS.md` (current/next, validation, Git checkpoint)
2. update `ROADMAP.md` if scope/status/DoD changed
3. run `npm test` / `npm run typecheck` / `npm run build` as appropriate
4. update Graphify when structurally warranted (`graphify extract . --code-only --force && graphify cluster-only .`)
5. record `git log --oneline -1` checkpoint

This file is the first place to look for `Where are we?` — `ROADMAP.md` is the product direction, `PROGRESS.md` is the execution truth.
