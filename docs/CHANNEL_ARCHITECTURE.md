# ConvoxOS Channel Architecture

Living description of how ConvoxOS treats communication channels.
This is the architectural direction inferred from the current
repository, not a plugin-framework specification.

Related:

- [CHANNEL_MODULE.md](./CHANNEL_MODULE.md) — what a channel module is
- [CHANNEL_CONNECTIONS.md](./CHANNEL_CONNECTIONS.md) — connection/config target
- [phase-3-channel-aware-inbox.md](./phase-3-channel-aware-inbox.md) — Inbox UX checkpoint
- [ROADMAP.md](../ROADMAP.md) — phases and non-goals
- [PROGRESS.md](../PROGRESS.md) — what is shipped

---

## Principle

**ConvoxOS is the CRM/core and acts like a socket. External
communication channels are plugs/modules that connect to that
socket.**

WhatsApp is special: the product was originally built around it.
We do **not** rip WhatsApp apart and force it through a generic
abstraction for elegance.

```text
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

- **WhatsApp remains the established/native core.** Templates,
  broadcasts, media, the 24-hour session window, Meta registration,
  and Settings → WhatsApp stay in the existing WhatsApp system.
- **The channel socket is the boundary for external modules.**
  Telegram is the first experimental plug.
- **A future channel should be installable/configurable without
  modifying WhatsApp internals or rewriting the CRM.**

That last sentence is the objective, not a claim that a generic
plugin loader already exists.

---

## ConvoxOS core (CRM-owned)

These stay in the host, shared across channels:

- Tenancy: `accounts`, `profiles`, `is_account_member`, RLS
- Unified `contacts` (one row per person per account)
- Unified `conversations` (`UNIQUE(account_id, contact_id)` — no
  `Conversation.channel`)
- Unified `messages` with **`messages.channel` provenance only**
- Inbox (list, thread, composer, filters) — channel-*aware*, not
  channel-*owned*
- Pipelines, deals, tags, custom fields, dashboard
- **Flows / Automations — channel-neutral logic, channel-aware send**
  (`processNormalizedInbound` → `FlowRun.trigger_channel` + `AutomationContext.trigger_channel` → `send_* {channel_target: current|whatsapp|telegram}` → `ChannelSocket dispatch`)
- Account webhooks (`/api/v1/webhooks`), API keys, MCP
- Shared crypto primitive (`encrypt` / `decrypt` — currently lives
  under `src/lib/whatsapp/encryption.ts` but is already reused by
  Telegram)

Shared inbound host:

- `src/lib/inbound/processNormalizedInbound.ts`
- Contract: `NormalizedInbound` in `src/lib/channels/types.ts`

---

## WhatsApp as native core

WhatsApp is **not** modeled as “just another plug” today. It owns:

| Concern | Location |
|---|---|
| Settings UI | `src/components/settings/whatsapp-config.tsx` (hosted under `Channels`) |
| Settings rail | `settings-sections.ts` tab `channels` (WhatsApp card inside) |
| Config API | `GET/POST /api/whatsapp/config` |
| Storage | `whatsapp_config` (one row per account) |
| Credentials | encrypted access token + Meta IDs + verify token + PIN |
| Webhook | `POST /api/whatsapp/webhook` (HMAC via `META_APP_SECRET`) |
| Send | `src/lib/whatsapp/send-message.ts`, `/api/whatsapp/send` |
| Identity | `contacts.phone` / `phone_normalized` |
| Session window | `src/lib/whatsapp/session.ts` (WhatsApp inbound only) |
| Templates / broadcasts / interactive / media | existing `whatsapp/*` |

The WhatsApp webhook already **delegates** CRM persistence to
`processNormalizedInbound` so Telegram inbound can share that host
without rewriting Meta handling.

---

## Channel socket (external modules)

The socket is **not** a `channels` table, a factory, or a registry.
In the current code it is a **combination of conventions and
contracts**:

1. **Module structure** — `src/lib/channels/<provider>/`
   (Telegram: `normalize.ts`, `send.ts`; WhatsApp stub:
   `src/lib/channels/whatsapp/normalize.ts`)
2. **Per-provider config table** — `telegram_config` mirrors
   `whatsapp_config` (one row per account, encrypted credentials,
   `status`, RLS admin write). Not a generic `channels` table.
3. **Normalized inbound contract** — `NormalizedInbound`
   (`channel`, `accountId`, provider message id, kind, identity
   fields). Provider webhook authenticates, then normalizes, then
   calls `processNormalizedInbound`.
4. **Message provenance** — `messages.channel`
   `CHECK (whatsapp, telegram)`, default `whatsapp`.
5. **Provider-specific outbound** — dedicated sender + route
   (`sendTelegramText`, `/api/telegram/send`). No `ChannelSender`.
6. **Inbox derivation** — channel identity is computed from
   `messages.channel` and contact fields (`phone` vs
   `telegram_user_id`), never stored on the conversation.

What is **not** yet a socket, and was the Phase 4 gap (now shipped for Telegram):

- In-product **connect / configure / disconnect** for external
  plugs — Telegram now has `GET/POST/DELETE /api/telegram/config`
  + `src/lib/channels/telegram/api.ts` (`getMe`, `setWebhook`,
  `deleteWebhook`) + `src/components/settings/telegram-config.tsx`
  hosted under `Settings → Channels`. Future external plugs would
  clone this per-provider table + module pattern per
  [CHANNEL_CONNECTIONS.md](./CHANNEL_CONNECTIONS.md).

**Channel-neutral automation (shipped):** Flows/Automations are
**one engine each, channel-neutral logic, channel-aware send**
(`flow_runs.trigger_channel` snapshot + `send_* {channel_target: current|whatsapp|telegram}` + `trigger_config.channel any|whatsapp|telegram`) dispatched through thin `ChannelSocket` (`whatsapp/send-message` vs `telegram/send(+media+keyboard)`) — no `ChannelFactory`.

---

## Telegram as the first reference plug

Implemented (Phases 1–4):

- `telegram_config` (`040`) — bot token encrypted, webhook secret,
  `status`, `UNIQUE(account_id)`, RLS
- Inbound webhook `POST /api/telegram/webhook/[configId]`
- `normalizeTelegramUpdate` → `NormalizedInbound`
- Unified contact (`telegram_user_id` / `telegram_chat_id`, nullable
  `phone`)
- Unified conversation
- `messages.channel = 'telegram'`
- Manual **text** outbound (`sendTelegramText`)
- Inbox: Reply via, filters, mixed threads, Telegram-not-connected,
  WhatsApp 24h isolated from Telegram
- **Connection management (Phase 4)** — `src/lib/channels/telegram/api.ts`
  (`getMe`, `setWebhook`, `deleteWebhook`, sanitized `TelegramApiError`),
  `GET/POST/DELETE /api/telegram/config` (admin write, viewer read,
  `NEXT_PUBLIC_SITE_URL` preferred with request-origin fallback,
  hard-delete preserve history, secrets never returned/logged),
  `src/components/settings/telegram-config.tsx` under
  `Settings → Channels` aggregator (`src/components/settings/channels-panel.tsx`,
  `settings-sections.ts` tab `channels`, legacy `?tab=whatsapp` → `channels`),
  Overview channels tile, `403`/`400`/`502` sanitized errors, webhook URL display

Remaining implicit scope (not a gap, just not generalized):

- Capabilities are implicit (Inbox hardcodes WhatsApp vs Telegram
  ternaries; `CHANNEL_ORDER` in `inbox/conversations.ts`)

---

## Normalized model

```text
Provider webhook
    → authenticate (provider-specific)
    → normalize to NormalizedInbound
    → processNormalizedInbound
         find/create contact (channel-aware identity)
         find/create conversation (unified, oldest-first)
         upsert message (channel provenance)
         bump / reopen
         WA-only: flag broadcast reply
         flows / automations / AI (shared)
```

Conversations stay **one thread per contact**. Mixed WhatsApp +
Telegram history is one conversation with per-message `channel`.

---

## How a future channel should conceptually plug in

Ideal path (Instagram / Messenger as examples, **not implemented**):

```text
Add channel module
        ↓
Configure it in Settings
        ↓
Connect provider
        ↓
Provider webhook/API
        ↓
Normalize into ConvoxOS
        ↓
Unified CRM
        ↓
Channel-aware Inbox
```

What that would require in *this* architecture, without a factory:

- A provider-specific `*_config` table (credentials, status, RLS)
- A module under `src/lib/channels/<name>/` (normalize + send)
- A webhook route that authenticates **without scanning secrets**
- Identity column(s) on `contacts` (analogue of `telegram_user_id`)
- `messages.channel` value (today a CHECK constraint — adding a
  channel is a **schema** change, not a row in a channels table)
- Inbox availability rule (analogue of `getAvailableContactChannels`)
- **No WhatsApp rewrite**, no `Conversation.channel`

Until a second *external* plug is proven, we do not introduce a
registry. Telegram is still proving the connection-management gap.

---

## Explicit non-goals

Do **not**:

- Rewrite WhatsApp as a generic provider
- Add `Conversation.channel`
- Add a `channels` table because it sounds generic
- Add `ChannelFactory` / `ChannelRegistry` / `ChannelSender`
- Build a plugin marketplace
- Implement Instagram / Messenger in this milestone
- Implement Telegram media, templates, or broadcasts here

---

## Architecture principles

1. Preserve WhatsApp behavior.
2. Keep CRM entities unified; use `messages.channel` for provenance.
3. Provider logic stays in the provider module.
4. Avoid premature abstractions — wait for a second proven external
   plug **and** a connection UX before generalizing.
5. Account / RLS boundaries on every config table.
6. Prefer a small, maintainable architecture.

---

## Current implementation status

| Area | Status |
|---|---|
| Unified contacts / conversations / messages | Shipped |
| `NormalizedInbound` + `processNormalizedInbound` | Shipped |
| WhatsApp core (Settings, webhook, send, templates, …) | Shipped |
| Telegram inbound | Shipped (Phase 1) |
| Telegram manual text outbound | Shipped (Phase 2) |
| Channel-aware Inbox UX | Shipped (Phase 3) |
| Telegram in-product connection/config | Shipped (Phase 4) — `GET/POST/DELETE /api/telegram/config`, `telegram/api.ts`, `Settings → Channels` |
| Telegram media + inline keyboards | Shipped (Phase 5) |
| Channel-neutral Flows / Automations | Shipped (FlowRun.trigger_channel + channel_target + ChannelSocket) |
| Channel capability matrix + Target contracts | Shipped as specs (2026-08-31 audit): `docs/specs/channel-capabilities.md` + `node-system.md` + `crm-automation.md`; P0 TG cap bug filed |
| Generic plugin framework | Intentionally absent (see `docs/research/architectural-gap.md` §3) |
| Additional channel modules | TBD (Instagram/Messenger next — same plugs pattern) |
| Audit gaps (P0/P1/P2) | Tracked in `docs/research/gap-matrices.md` + `ROADMAP.md` Audit Checkpoint + `PROGRESS.md` |

**Reconstruction audit (2026-08-31):** `docs/research/CONVOXOS_RECONSTRUCTION_AUDIT.md` (16 sections) + `docs/research/manychat-model.md` + `highlevel-model.md` + `builder-ux-model.md` + `channel-behavior.md` + `repo-audit.md` + `gap-matrices.md` + `architectural-gap.md` establish target lifecycle Draft→Validate→Test→Publish→Active→Paused(preserve waiting)→Archived, 30-block cap, and `Current` fidelity. `P0` before P1: channel-aware caps.
