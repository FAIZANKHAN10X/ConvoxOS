# ConvoxOS Channel Module

What “channel module” means **today**, based on Telegram as the first
external plug and WhatsApp as the native core.

This is a **conceptual contract**. There is no TypeScript
`ChannelModule` interface, no factory, and no registry in the
repository. Do not invent one until a second external plug plus
in-product connection UX force it.

See [CHANNEL_ARCHITECTURE.md](./CHANNEL_ARCHITECTURE.md) for the
host/socket picture and [CHANNEL_CONNECTIONS.md](./CHANNEL_CONNECTIONS.md)
for connect/configure/disconnect.

---

## Module responsibilities

A channel module owns **provider-specific** work:

- Credentials and how they are stored (encrypted columns on a
  per-provider config table)
- Connection to the provider (webhook subscribe, token validation)
- Webhook HTTP mechanics and authentication
- Provider API calls (send, getMe, SetWebhook, …)
- Provider message formats
- Normalization **into** `NormalizedInbound`
- Provider capabilities (text-only vs media vs templates)
- Provider-specific configuration UI **where it exists**

A module must **not** own:

- Contact / conversation / message CRM tables as its private store
- Inbox layout or conversation identity
- Account membership / RLS policy language (it *uses* `is_account_member`)
- Automations, flows, or AI engines (those consume shared inbound)

---

## Configuration

**Pattern in code:** one config table per provider, one row per
account.

| | WhatsApp | Telegram |
|---|---|---|
| Table | `whatsapp_config` | `telegram_config` (`040`) |
| Cardinality | `UNIQUE(account_id)` | `UNIQUE(account_id)` |
| RLS read | `is_account_member` | `is_account_member` |
| RLS write | admin | admin |
| Encrypted secrets | access token (and related) | `bot_token_encrypted`, `webhook_secret_encrypted` |
| Status | `connected` / `disconnected` | `connected` / `disconnected` |

Telegram config was **schema-complete** for inbound + text outbound; it is now
also **product-complete** (Phase 4): `GET/POST/DELETE /api/telegram/config`
validates via `getMe`, encrypts `bot_token`/`webhook_secret`, calls
`setWebhook`/`deleteWebhook`, sanitizes provider errors, never returns
plaintext tokens, hard-deletes row on disconnect while preserving history.
WhatsApp config remains **product-complete** (Settings UI + `/api/whatsapp/config`
validates with Meta, encrypts, registers the number).

Telegram is surfaced as a card inside `Settings → Channels`
(`SETTINGS_SECTIONS` `channels`, `src/components/settings/channels-panel.tsx` →
`telegram-config.tsx` + `whatsapp-config.tsx`); `?tab=whatsapp` remains a
legacy alias to `channels`.

---

## Connection lifecycle

### WhatsApp (implemented)

Settings UI → `POST /api/whatsapp/config` → verify with Meta →
encrypt token → upsert `whatsapp_config` → optional phone
registration / WABA subscribe → `GET /api/whatsapp/config` reports
`connected`. Webhook URL is displayed as
`{origin}/api/whatsapp/webhook` for the operator to paste in Meta.

### Telegram (shipped — Phase 4)

Per `040` comments + `src/lib/channels/telegram/api.ts`:

1. Admin pastes bot token in `Settings → Channels → Telegram → Connect`
2. Server validates via `getMe`, encrypts token, generates webhook secret, upserts `telegram_config`
3. Server calls Telegram `setWebhook` to `/api/telegram/webhook/<telegram_config.id>` with `secret_token`
4. Inbound `POST` carries `X-Telegram-Bot-Api-Secret-Token`; webhook verifies via `decrypt(webhook_secret_encrypted)` + PK lookup `telegram_config.id`
5. `GET /api/telegram/config` reports safe status (never returns token, sanitizes `TelegramApiError`); `DELETE` best-effort `deleteWebhook` then hard-deletes row, preserving `contacts`/`conversations`/`messages` history

WhatsApp path unchanged.

---

## Inbound

| | WhatsApp | Telegram |
|---|---|---|
| Route | `POST /api/whatsapp/webhook` | `POST /api/telegram/webhook/[configId]` |
| Auth | Meta HMAC (`META_APP_SECRET`) | Secret header vs decrypted `webhook_secret` |
| Tenancy lookup | `whatsapp_config.phone_number_id` | `telegram_config.id` (never scan `bot_token`) |
| Next step | Normalize + `processNormalizedInbound` | `normalizeTelegramUpdate` + `processNormalizedInbound` |

Webhook auth and routing stay **inside the module**. The CRM host
starts at `processNormalizedInbound`.

---

## Normalization

Boundary type: `NormalizedInbound` in `src/lib/channels/types.ts`.

Required conceptually:

- `channel`
- `accountId`
- `configOwnerUserId`
- `providerMessageId` (stable, prefixed: `wamid…` / `tg_<chat>_<id>`)
- `kind` (`text` \| `interactive_reply` \| `media` \| `location` \|
  `reaction`)
- Provider identity fields (`senderPhone` **or** `telegramUserId` /
  `telegramChatId`)

Normalizers are pure-ish mappers: Telegram’s
`normalizeTelegramUpdate` does not touch the DB or decrypt the bot
token. WhatsApp still does richer media/template parsing in the
webhook; `src/lib/channels/whatsapp/normalize.ts` is a stub for
identity/kind symmetry.

---

## Identity

CRM contacts remain unified.

- WhatsApp: `contacts.phone` / `phone_normalized` (index unchanged
  for empty phone)
- Telegram: `telegram_user_id` (`UNIQUE(account_id, telegram_user_id)`),
  `telegram_chat_id` for routing, `telegram_username` metadata
- Phone is nullable so a Telegram-only person can exist

A future plug would add **its own** stable identity column(s), not a
generic `channel_identities` table, until a second plug proves
duplication.

---

## Outbound

Not a shared sender.

| | WhatsApp | Telegram |
|---|---|---|
| Function | `sendMessageToConversation` | `sendTelegramText` |
| Route | `/api/whatsapp/send` | `/api/telegram/send` |
| Authz | `requireRole('agent')` | `requireRole('agent')` |
| Rate limit | existing send limiter | `send-telegram:<userId>` |
| Capabilities | text, media, template, interactive | **text only** (4096) |
| Persist | `messages.channel = 'whatsapp'` | `messages.channel = 'telegram'` |

Inbox `handleSend` branches on `selectedChannel`. That branch is
acceptable while there are two providers; it is **not** a registry.

Public API `POST /api/v1/messages` is **WhatsApp-only** (phone +
Meta send). MCP `send_message` is the same. Those are core-API
gaps for a complete Telegram plug, not socket interfaces.

---

## Capabilities

Today capabilities are **implicit in UI and senders**, not declared:

- WhatsApp: session window, media/interactive/template in composer
- Telegram: text only; `whatsappOnlyDisabled` when Telegram is
  selected; Telegram is never blocked by the WhatsApp 24h window

A future `capabilities` object on a module is **TBD**. Do not add a
capability registry for one experimental plug.

---

## Inbox integration

Inbox is CRM-core. It consumes module facts:

- `messages.channel` for list badges, filters, message chrome
- `contact.phone` / `contact.telegram_user_id` for Reply via
- `telegram_config` presence for “Telegram not connected”
- `isWhatsAppSessionExpired` uses **WhatsApp inbound only**

`src/lib/inbox/conversations.ts` hardcodes
`CHANNEL_ORDER = ['whatsapp', 'telegram']` and an if/else in
`getAvailableContactChannels`. That is the current two-channel
surface, not a plugin hook.

---

## Provider-specific boundaries (must not leak into CRM core)

Keep in the module (or WhatsApp core):

- Meta Cloud API, WABA, PIN, 24h session
- Telegram Bot API, `chat_id`, 4096 limit, secret-token header
- Template HSM approval, Telegram (lack of) templates
- Provider error mapping (`SendTelegramError`, Meta errors)

CRM core may know **`channel` as a provenance string** and contact
identity columns. It must not import Telegram Bot API types into
automations, broadcasts, or conversation schema.

Shared crypto should eventually be treated as **core**
(`encrypt`/`decrypt` + `ENCRYPTION_KEY`) even though the file still
lives under `src/lib/whatsapp/`. Telegram already imports it. Moving
the file is optional cleanup, not a new abstraction.

---

## What a complete Telegram plug has (Phase 4)

Shipped: inbound, normalize, identity, unified conversation, text
send, Inbox awareness, **plus**

- `Settings → Channels` host (`channels-panel.tsx`)
- `GET/POST/DELETE /api/telegram/config` (admin write, viewer read, webhook lifecycle, sanitized errors)
- `src/lib/channels/telegram/api.ts` provider helpers
- `src/components/settings/telegram-config.tsx` connect/test/disconnect, bot username/id + webhook URL display
- Overview tile now summarizes `channels` (WhatsApp + Telegram)

Should stay Telegram-module-owned: bot token, `setWebhook`, secret
token, Telegram API errors, 4096 limit.

Should stay ConvoxOS-core: Settings **host**, account scoping, RLS, Inbox, `processNormalizedInbound`.
