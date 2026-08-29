# ConvoxOS

ConvoxOS is a CRM/operations platform with a unified communication Inbox
designed around a modular channel architecture. Contacts, conversations,
and messages stay in one CRM core. Channel-specific work lives in
channel modules.

WhatsApp is the existing/core channel. Telegram is the first external
channel module.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/FAIZANKHAN10X/ConvoxOS/actions/workflows/ci.yml/badge.svg)](https://github.com/FAIZANKHAN10X/ConvoxOS/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## What ConvoxOS Is

- **CRM core** — accounts, profiles, contacts, conversations, messages,
  Inbox, pipelines/deals, tags/custom fields, automations, flows,
  broadcasts, AI reply/knowledge, dashboard, team roles, public API,
  and MCP.
- **Unified contacts** — one contact record per person in an account.
  WhatsApp identity is phone-based; Telegram identity uses
  `telegram_user_id` / `telegram_chat_id` (phone may be null).
- **Unified conversations** — one conversation per account+contact.
  There is no `Conversation.channel`.
- **Messages with channel provenance** — `messages.channel` records
  whether a message arrived or was sent on WhatsApp or Telegram.
- **Channel-aware Inbox** — when a contact has both a phone number and
  a Telegram identity, the composer can choose **Reply via** WhatsApp
  or Telegram.
- **WhatsApp as the existing/core integration** — Meta Cloud API
  (official WhatsApp Business API). Inbox, templates, broadcasts,
  media, session windows, and related WhatsApp behavior remain the
  stable core.
- **Telegram as the first external channel module** — inbound webhook
  plus manual text outbound. Provider-specific logic stays in
  `src/lib/channels/telegram/`.

## Channel Architecture

This is the architectural **direction**, not a generic plugin framework.
New channels are intended to plug into the CRM without rewriting the
existing WhatsApp system.

```text
                 ConvoxOS CRM
                      │
               Channel boundary
          ┌───────────┼───────────┐
          │           │           │
      WhatsApp     Telegram    Future
       existing     module     modules
        core
```

What that means in the current code:

- The CRM owns contacts, conversations, Inbox, auth, and account/RLS
  boundaries.
- Inbound channel modules normalize to a shared shape and call
  `processNormalizedInbound`.
- Telegram outbound is a dedicated sender (`sendTelegramText`) and
  route (`/api/telegram/send`), not a generic `ChannelSender`.
- We intentionally do **not** have a `channels` table,
  `Conversation.channel`, or a factory/registry/bus.

See [ROADMAP.md](./ROADMAP.md) for the product direction and
[PROGRESS.md](./PROGRESS.md) for what is done. Channel host vs
WhatsApp core vs external plugs:

- [docs/CHANNEL_ARCHITECTURE.md](./docs/CHANNEL_ARCHITECTURE.md)
- [docs/CHANNEL_MODULE.md](./docs/CHANNEL_MODULE.md)
- [docs/CHANNEL_CONNECTIONS.md](./docs/CHANNEL_CONNECTIONS.md)

## Current Capabilities

### CRM core (implemented)

- Shared Inbox with assignment, status, and notes
- Contacts, tags, custom fields, CSV import, phone deduplication
- Sales pipelines (Kanban) and deals
- Broadcasts with Meta-approved WhatsApp templates
- No-code automations and a visual flow builder
- AI reply assistant (bring-your-own OpenAI or Anthropic key) and
  optional knowledge base
- Real-time dashboard
- Team accounts with owner / admin / agent / viewer roles
- Public REST API (`/api/v1`) with scoped API keys — see
  [docs/public-api.md](./docs/public-api.md)
- MCP server in [`mcp-server/`](./mcp-server) — see
  [docs/mcp.md](./docs/mcp.md)

### WhatsApp (existing core)

- Inbound webhook and outbound send (text, media, templates,
  interactive) via the Meta Cloud API
- Session-window handling for customer-care messages
- WhatsApp-specific config, encryption, and registration

### Telegram (first external module)

Implemented today:

- **Inbound** — `telegram_config` (one bot per account), webhook
  `POST /api/telegram/webhook/[configId]`, normalization into the
  shared inbound pipeline, unified contact + conversation, messages
  stored with `channel = 'telegram'`
- **Manual text outbound** — `sendTelegramText` and
  `POST /api/telegram/send` (agent role, rate-limited)
- **Inbox channel selection** — `Reply via` WhatsApp or Telegram when
  both identities exist; Telegram send is text-only
- **Connection management (Phase 4)** — `Settings → Channels`
  aggregator, `GET/POST/DELETE /api/telegram/config` (validate
  via `getMe`, encrypted at rest, `setWebhook`/`deleteWebhook`,
  admin write / viewer read, webhook URL `NEXT_PUBLIC_SITE_URL`
  + request-origin fallback), hard-delete disconnect preserves
  history

Not implemented (do not assume they exist):

- Telegram media, templates, interactive messages, or broadcasts
- Per-channel Telegram automations/AI (inbound still fans out through
  the shared pipeline)
- Additional channel modules
- A generic plugin/registry framework

## Architecture Principles

- Keep CRM-core behavior separate from channel-specific implementation
- Keep conversations unified; use `messages.channel` for provenance
- Leave provider-specific logic inside the provider module
- Avoid premature abstractions (no channel table, no generic sender)
- Preserve existing WhatsApp behavior when adding channels
- Honor account / RLS boundaries (`is_account_member`)
- Prefer a small, maintainable architecture over enterprise layering

## Tech Stack

From `package.json`:

- **App** — Next.js `16.2.12` (App Router), React `19.2.4`, TypeScript,
  Tailwind CSS v4, next-intl
- **Data** — Supabase (Postgres + Auth + Storage + RLS)
- **WhatsApp** — Meta Cloud API
- **Telegram** — Telegram Bot API
- **Tests / lint** — Vitest, ESLint, Prettier

Node `>=20`. Package manager: npm (`packageManager` field
`npm@10.9.9`).

## Development

```bash
git clone https://github.com/FAIZANKHAN10X/ConvoxOS.git
cd ConvoxOS
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. Unauthenticated visits go to `/login`.

Required env vars are documented in [`.env.local.example`](./.env.local.example).
Apply database migrations from `supabase/migrations/` to your Supabase
project (local: Supabase CLI; hosted: `supabase db push` or the SQL
editor).

Docker / Compose: [docs/docker.md](./docs/docker.md).

Useful scripts from `package.json`:

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Run the production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (one shot) |
| `npm run test:watch` | Vitest watch |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Run these after changes. CI (`.github/workflows/ci.yml`) runs lint,
typecheck, test, and build on `main`.

## Project Roadmap

See [ROADMAP.md](./ROADMAP.md).

## Project Progress

See [PROGRESS.md](./PROGRESS.md).

## License

[MIT](./LICENSE).

## Author

Faizan Khan
