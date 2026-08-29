# Channel connection management

Architectural description of how operators connect communication
channels inside ConvoxOS. WhatsApp established the pattern; Telegram
connection is now shipped (Phase 4) using the same per-provider table
approach.

See [CHANNEL_ARCHITECTURE.md](./CHANNEL_ARCHITECTURE.md) and
[CHANNEL_MODULE.md](./CHANNEL_MODULE.md).

---

## Why this exists

Telegram receives and sends text and the Inbox is channel-aware.
Before Phase 4, connecting the bot happened outside the product
(manual `telegram_config` insert + Telegram `SetWebhook`). After
Phase 4 it is `Settings → Channels → Telegram → Connect` (admin).

WhatsApp is configured from **Settings → Channels → WhatsApp** by a
normal admin: paste credentials, test, save, register the number.

The connection surface is now product-level for both channels; media,
templates, and additional providers remain out of scope.

---

## Desired operator flow

```text
Settings
   │
   └── Channels
        │
        ├── WhatsApp     Connected / Manage
        ├── Telegram     Connected / Manage
        ├── Instagram    Connect          (future)
        └── Messenger    Connect          (future)
```

```text
Settings → Channels → Connect → Configure → Validate → Connected → Manage / Disconnect
```

The user should not open source, edit database rows, or understand
provider internals to connect a **supported** channel.

Both WhatsApp and Telegram now map onto that flow inside
`Settings → Channels` (`channels-panel.tsx`), with WhatsApp as the
native core card and Telegram as the first external plug card;
`?tab=whatsapp` remains a legacy alias to `channels`.

---

## WhatsApp today (reference implementation)

```text
Settings UI (WhatsAppConfig)
    → load whatsapp_config by account_id
    → GET /api/whatsapp/config  (test / health)
    → POST /api/whatsapp/config (save: Meta verify, encrypt, upsert)
    → registerPhoneNumber / subscribeWabaToApp (Meta)
    → webhook URL shown: {origin}/api/whatsapp/webhook
    → inbound HMAC webhook → processNormalizedInbound
    → outbound /api/whatsapp/send
    → Inbox
```

Evidence:

- UI: `src/components/settings/whatsapp-config.tsx` (hosted under Channels) + `src/components/settings/channels-panel.tsx`
- Rail: `SETTINGS_SECTIONS` includes `channels` (`whatsapp` is a legacy alias)
- Overview tile now summarizes `channels` (WhatsApp + Telegram)
- API: `src/app/api/whatsapp/config/route.ts` + `src/app/api/telegram/config/route.ts`
- Tables: `whatsapp_config` / `telegram_config` (`UNIQUE(account_id)`, admin write RLS)
- Status: `connected` / `disconnected` plus live probes
  (`connected: true | false`, reasons `no_config`,
  `token_corrupted`, `meta_api_error` / `telegram_api_error`)

Credentials: long-lived Meta access token, `phone_number_id`,
`waba_id`, verify token, optional 6-digit PIN. Token is encrypted
at rest with `ENCRYPTION_KEY`. UI shows a mask unless re-entered.

Webhook lifecycle: ConvoxOS **displays** the callback URL; the
operator (or Meta app config) points Meta at it. HMAC secret is
platform env `META_APP_SECRET`, not per-row.

---

## Telegram today (shipped — Phase 4)

```text
Settings → Channels → Telegram → Connect
    → POST /api/telegram/config {bot_token} → getMe → encrypt → upsert telegram_config
    → setWebhook {site}/api/telegram/webhook/<id> {secret_token}
    → GET /api/telegram/config (safe status, sanitized errors)
    → POST /api/telegram/webhook/[configId] → normalize → processNormalizedInbound
    → sendTelegramText / /api/telegram/send
    → Inbox (reads telegram_config status + safe GET)
    → DELETE /api/telegram/config → deleteWebhook best-effort → hard-delete row (history preserved)
```

No manual DB insert or operator `setWebhook` required; `040` anticipates this lifecycle.

---

## Conceptual contract (implemented for WhatsApp + Telegram)

A channel connection, conceptually:

| Field | Meaning |
|---|---|
| Provider id | `'whatsapp'` \| `'telegram'` \| future string |
| Account | `account_id` — never global |
| Credentials | provider-specific, encrypted at rest |
| Status | at least `disconnected` / `connected` (and a live probe) |
| Webhook locator | URL the provider should call |
| Display | phone, bot username, … |

**Storage:** keep **per-provider tables**. Do not introduce a
`channels` table for this milestone. WhatsApp and Telegram already
differ (Meta IDs vs bot token; HMAC env vs per-row secret).

**API:** a thin, provider-specific config route is enough (clone the
WhatsApp pattern: `GET` health, `POST` save/validate, later
disconnect). A generic `/api/channels/:id` is not justified yet.

**UI host (core):** Settings should grow a **Channels** grouping so
WhatsApp is “Manage” and Telegram is “Connect”. WhatsApp’s existing
panel can remain the WhatsApp core UI behind that grouping.
Telegram’s panel is new module UI hosted by Settings.

**UI module (Telegram):** bot token input, test (`getMe`), save,
show webhook URL / bot username, connect/disconnect. Provider
fields stay Telegram-specific.

---

## Credentials

- Encrypt with the existing AES-256-GCM helper and `ENCRYPTION_KEY`
  (same as WhatsApp tokens and Telegram tokens already).
- Never return the raw secret on GET; mask in the UI.
- Never use the bot token or access token as a webhook **router**
  (Telegram already PK-looks-up `telegram_config.id`).
- Admin-only writes (`is_account_member(..., 'admin')`), members
  may read connection status (Inbox already needs it).
- Decrypt only at the moment of provider I/O (send, SetWebhook,
  Meta verify).

---

## Connection status

Distinguish:

1. **Row exists** — config saved
2. **Provider accepts credentials** — Meta probe / Telegram `getMe`
3. **Webhook live** — Meta subscribed / Telegram `getWebhookInfo` (info read on demand, not persisted)

`GET /api/whatsapp/config` and `GET /api/telegram/config` both approximate (1)+(2) with `status` cache + live `getMe`; Inbox derives `Telegram not connected` from `telegram_config status` without calling the provider. `Test connection` is the authoritative live probe.

---

## Account scoping and RLS

Unchanged from current tables:

- One connection per provider per account
- Select: account members
- Insert/update/delete: admin
- Service role for webhooks (cannot use the user JWT)

Webhook handlers must not leak whether a config id exists beyond
generic 404/401 (Telegram already does this).

---

## Webhook lifecycle

### WhatsApp (keep)

Platform HMAC + displayed callback URL. Registration of the
**phone** with Meta is already in the config POST path. Do not
fold this into a generic webhook manager.

### Telegram (shipped)

On connect (`POST /api/telegram/config`):

1. Validate token via `getMe`
2. Persist encrypted bot token + generate webhook secret (encrypted)
3. `setWebhook` to `{site}/api/telegram/webhook/{telegram_config.id}` with `secret_token`; `NEXT_PUBLIC_SITE_URL` preferred, request origin fallback, fail clearly on loopback without env
4. Mark `connected` / `connected_at`

On disconnect (`DELETE /api/telegram/config`):

1. `deleteWebhook` (best-effort, network/5xx swallowed)
2. Hard-delete `telegram_config` row; never leave a live endpoint authenticated with an old secret without a row; `contacts`/`conversations`/`messages` history preserved

`NEXT_PUBLIC_SITE_URL` (or request origin, with the same care as
invites) is the public base for webhook URLs.

---

## Core vs module

| | Core | Module |
|---|---|---|
| Settings shell / Channels grouping | yes | |
| Account + RLS | yes | uses |
| Encrypt/decrypt primitive | yes (file currently under whatsapp/) | uses |
| Provider credential fields | | yes |
| Validate with provider | | yes |
| SetWebhook / Meta register | | yes |
| Persist `*_config` row | host DB, module-shaped table | yes |
| Inbox “not connected” | reads status | does not call provider |

---

## Non-goals for Phase 4

- Instagram / Messenger connect
- A generic `channels` table or channel marketplace
- Changing WhatsApp’s Meta registration flow
- Telegram media/templates
- Moving secrets to a third-party vault

Phase 4 made Telegram connectable from `Settings → Channels` using
the WhatsApp config flow as the pattern, not as a shared factory.
Future channels clone the per-provider table + module shape.
