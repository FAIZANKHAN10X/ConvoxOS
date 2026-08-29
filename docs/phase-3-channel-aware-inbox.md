# Phase 3: Channel-Aware Inbox

Phase 3 makes the existing unified Inbox visibly channel-aware while keeping
WhatsApp and Telegram provider behavior at their current boundary.

## Current behavior

- Conversations remain unified; channel provenance is stored on messages.
- Inbox filtering supports All, WhatsApp, and Telegram.
- Mixed conversations appear in both applicable channel filters.
- Thread headers and message groups identify WhatsApp/Telegram activity.
- Reply selection remains local to the open thread and is never persisted as
  conversation state.

## Provider boundaries

Channel-generic UI handles message provenance, channel filtering, contact
identities, and reply-channel selection. Provider-specific behavior remains
in the existing modules: WhatsApp's 24-hour session and rich-message
capabilities, and Telegram's current text-only capability and connection
state.

No `Conversation.channel`, channels table, channel registry, provider factory,
or schema migration is part of this phase.

## Correctness note

The WhatsApp 24-hour window is calculated only from the latest inbound
WhatsApp customer message. Telegram activity cannot extend or alter that
window. Regression tests cover WhatsApp-only, Telegram-only, and mixed
history.

## Validation

The implementation checkpoint passed:

- `npm run lint` — 0 errors, 49 warnings
- `npm run typecheck` — passed
- `npm test` — 84 files, 869 tests passed
- `npm run build` — passed
- Impeccable UI detector — no findings
