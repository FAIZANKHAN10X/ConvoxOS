# Channel Capability Model — Canonical Matrix (2026-08-31)

> Synthesized from `docs/research/channel-behavior.md`. Builder must prevent invalid combinations **before runtime**. `ChannelSocket` (`src/lib/channels/socket.ts:1`) stays thin and returns normalized `ChannelSocketError` for any that slip through.

## 1. Capability Definitions

| Capability | What it means |
|------------|---------------|
| **Text** | Plain text body; no interactive. |
| **Image** | Image file/URL dispatched as media. |
| **Video** | Video file/URL. |
| **Document / File** | Generic file (PDF, etc.) with optional filename. |
| **Audio / Voice** | Audio clip / voice note. Audio = file with caption; Voice = audio/ogg. |
| **Button** | Inline reply button (`reply_id` ↔ provider callback). |
| **List** | Sectioned tappable rows (WA native; TG flattened to inline keyboard). |
| **Card / Gallery** | Rich card with image+title+subtitle+buttons; Gallery = carousel up to 10. |
| **Typing indicator** | Simulated typing pause. |
| **Input collection** | Prompt → await free-text reply into var. |
| **Inline keyboard** | Provider-specific button grid attached to message (TG `inline_keyboard`). |
| **Template** | Pre-approved structured message (Meta HSM). |
| **Quick reply** | Short-lived reply chip (variant of button). |
| **Attachment** | Any file attached to message (superset of File). |
| **Interactive** | Buttons or lists as a typed payload. |

## 2. Canonical Matrix — WhatsApp vs Telegram (implemented scope)

| Capability | WhatsApp | Telegram | Builder behavior | Notes |
|------------|----------|----------|------------------|-------|
| **Text** | ✔ | ✔ (4096 chars) | Always enabled | — |
| **Image** | ✔ | ✔ | Enabled both | Via public `chat-media` URL |
| **Video** | ✔ | ✔ | Enabled both | — |
| **Document** | ✔ | ✔ (generic File) | Enabled both | Telegram `File` maps to document |
| **Audio** | ✔ | ✔ | Enabled both | Socket maps voice→audio for WA |
| **Voice** | — (via audio) | ✔ | Hide on WA channel target | TG voice = audio/ogg |
| **Button** | ✔ ≤3, title ≤20 | ✔ ≤10, `callback_data` 1–64B | Limit shown per selected target channel | ManyChat verified 3 vs 10 gap — P0 fix |
| **List (rows)** | ✔ ≤10 total, row title ≤24 desc ≤72 | ✔ (flattened to inline keyboard rows) | Same as Button | TG transform `sections.flatMap(rows→button)` |
| **Card / Gallery** | — | — | Hidden both (no current TG card) | Instagram/Messenger only; ConvoxOS not yet |
| **Typing** | ✔ (session aware) | — | Hide indicator toggle on TG | TG has no typing indicator |
| **Input collection** | ✔ `collect_input` | ✔ same | Enabled both | — |
| **Inline keyboard** | — (uses interactive) | ✔ via `TelegramInlineMarkup` | Shown only on TG target | ChannelSocket passthrough |
| **Template** | ✔ approved HSM required | — | Locked to WA; TG choice → validation error | `Templates are only supported for WhatsApp` |
| **Quick reply** | via buttons | via inline keyboard | Alias of Button | — |
| **PDF** | via document | via document | Via document | — |
| **Delay typing block** | ✔ | ✔ (no indicator) | Indicator toggle per channel | Table §2.5 |

Verified table source: `docs/research/channel-behavior.md` §1–2; ManyChat `14281196200604` + `14281157003292`; TG Bot API docs inferred.

## 3. Extended Matrix — Research comparison only (Instagram/Messenger/SMS/Email — future plugs, not implemented)

| Capability | Instagram | Messenger | SMS | Email |
|------------|-----------|-----------|-----|-------|
| Text | ✔ | ✔ | ✔ (160) | ✔ |
| Image | ✔ | ✔ | ✔ | ✔ |
| Video | ✔ | ✔ | — | — |
| Audio | ✔ | ✔ | — | — |
| File | — | ✔ | — | ✔ attachment |
| Card | ✔ | ✔ | — | — |
| Gallery | ✔ | ✔ | — | — |
| PDF | ✔ | — | — | — |
| Messenger List | — | ✔ | — | — |
| Dynamic block | ✔ | ✔ | — | — |
| Buttons | ≤3 | ≤3 (+Call Number) | — | CTA/link |
| 24h window | ✔ +7d | ✔ +7d | DND only | — |

## 4. Limits Table (authoritative numbers for validation — parity with Meta/TG Bot API)

| Limit | Value | Source |
|-------|-------|--------|
| Text max (TG) | 4096 chars | `telegram/send.ts` |
| Caption (TG) | 1024 chars | `telegram/send-media.ts` |
| Buttons WA | ≤3 per message, title ≤20 | `INTERACTIVE_LIMITS` in `meta-api.ts` + `14281157003292` |
| Buttons TG | ≤10 per message, `callback_data` 1–64B, `https` URL only | `keyboard.ts:1` validate |
| List WA | ≤10 rows total, row title ≤24, description ≤72, button label ≤20 | `INTERACTIVE_LIMITS` |
| Image/video MIME | controlled by `meta-api` + TG mirror mime check `contentTypeForTelegramMime` | `telegram/send-media.ts` |
| Inline keyboard | 8×8 / 64 buttons max, url https only | `keyboard.ts:1` |

## 5. Channel Targeting Contract

### 5.1 Trigger filter

`trigger_config.channel?: "any"|"whatsapp"|"telegram"` (future `instagram|messenger`). Semantics in `triggerChannelMatches` (`flows/engine.ts:190`) + `triggerMatches` (`automations/engine.ts:759`):

- `any` or absent → always matches regardless of inbound channel.
- Specific value + inbound channel present → must equal.
- Specific value + inbound channel absent (manual/tag/time triggers) → passes (no channel to filter) for flows; **for automations `keyword_match`/`interactive_reply` the check fails-closed** — if timer requires specific channel but context has no trigger_channel, `return false` (prevents accidental firing of channel-specific messaging on non-conversational context).

Builder: `TriggerPanel` Channel `Any|WhatsApp|Telegram` chips (Phase F ephemerally derived — no persisted `flows.entry_channel`).

### 5.2 Node/Step target

`channel_target?: "current"|"whatsapp"|"telegram"` (future + `instagram|messenger`) on every send node/step (`send_message|buttons|list|media|collect_input|template`).

Resolver `resolveChannelTarget(raw, triggerChannelSnapshot)` (`flows/engine.ts:175`, `automations/engine.ts:63`, `socket.ts:222`):

- Legacy `null` → `whatsapp` (frozen compat).
- `current` → snapshot `trigger_channel`; null snapshot → `null` → hard error (`channel_target_missing`).
- Explicit `whatsapp|telegram` → that channel.
- Else → `null` → error.

**Rule: `current` without conversational context (e.g., tag_added-triggered automation using `current`) → deterministic error `Current requires inbound channel — choose WhatsApp or Telegram explicitly`, never silent WA default.** Already enforced in both engines.

No hidden WA default must remain — builder `validateOne` enforces `channel_target` required at publish (`validate.ts:62`, `flows/validate.ts:248`). Future P1: make flows template `send_buttons` default to `current` already correct (`templates.ts:94`).

### 5.3 Socket dispatch

`ChannelSocket` (`socket.ts:65 dispatchText, 110 dispatchMedia, 177 dispatchInteractive`) branches explicitly `if telegram → sendTelegram* else if whatsapp → sendMessageToConversation`. Never generic. Errors normalized:

- Missing identity (no phone / no telegram_chat_id) → `target_identity_missing 400`.
- Disconnected config → `channel_disconnected 400`.
- Unsupported kind → `capability_not_supported 400`.

### 5.4 How to add a new channel (canonical steps)

1. Add `*_config` table (encrypted creds, status, RLS admin write) per `telegram_config` pattern `040`.
2. `contacts.<provider>_user_id` identity column + UNIQUE where not null.
3. Extend `messages.channel CHECK` to add value (schema migration — not a row).
4. Extend `ChannelTarget` / `AutomationChannelTarget` unions (`types.ts:199`, `types/index.ts:533`).
5. Add `<provider>/normalize.ts` → `NormalizedInbound` + `send.ts` / `send-media.ts` + webhook route per provider.
6. Extend `socket.ts` branch (no factory — explicit).
7. Inbox `availableChannels` derivation + `Reply via` option.
8. Builder matrix row in this doc + instrument bar filter update.

No `channels` table, no `Conversation.channel`.

## 6. Authoring Restriction Strategy (builder-gated — not deferred to runtime)

| Strategy | When to use | Example |
|----------|-------------|---------|
| **Hide** | Capability wholly unsupported on that channel | Gallery on TG/WA → hide Card/Gallery blocks; File block hide on SMS-like channels |
| **Disable + tooltip** | Plan-gated or requires connection | Integrations card greyed until account connected (HighLevel verified pattern) |
| **Warning (severity=warning)** | Mismatch won't block publish but won't trigger | Trigger `telegram` but nodes target `whatsapp` explicit → warning `will never trigger` equivalent; `current` with mixed sends still valid but warn if trigger is `any` |
| **Error (severity=error, blocks publish)** | Missing required target / invalid combination | Empty text, missing template_name, button > cap for selected target, channel_target missing |
| **Transform (documented)** | Canal equivalence via mapping | WA `InteractiveButtonsPayload {id,title}` → TG `inline_keyboard [{text:title, callback_data:id}]`; WA list rows flatMap to TG rows; filename on doc |

Existing P0 bug: TG buttons validated against WA caps (≤3) even when `channel_target=telegram` → must switch to per-target cap before runtime mapping.

## 7. Runtime vs Authoring Boundary

- Authoring defines `channel_target`; runtime resolves `resolveChannelTarget` then `socket.dispatch*`. Provider-specific formatting lives in `telegram/*` and `whatsapp/*` — not in socket.
- Preview quick mode renders per-channel appearance (hidden unsupported blocks noted); full test mode executes against real provider if available, else logs `channel_disconnected`.
- 24h window enforcement WA-only (`session.ts`); Smart Delay >24h `does not reopen 24h window` (`manychat-model.md` §3.9) → downstream message needs template/list; TG needs none — documented in matrix.

## 8. Verification References

- ManyChat content blocks per channel: `14281196200604` (2026-03-19).
- Button caps 3 vs 10: `14281157003292`.
- Smart Delay TG exempt: `14281197046812` final note.
- Channel-specific triggers never firing warning: `14281166306332` ⚠️ Note.
- ConvoxOS channel-aware send snapshot + Current error: `src/lib/flows/engine.ts:175,190`; `src/lib/automations/engine.ts:63,759`; `src/lib/flows/validate.ts:248+`, `src/lib/automations/validate.ts:54`.

---
*Implementer checklist: before any new send node type, add its row to matrix §2, then gate builder picker by `authoringChannel`, then add validation branch on `channel_target`, then add socket branch.*
