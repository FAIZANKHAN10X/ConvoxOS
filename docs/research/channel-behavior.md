# Channel Behavior — ManyChat vs HighLevel vs ConvoxOS (Research: 2026-08-31)

> VERIFIED from `help.manychat.com` + `help.gohighlevel.com`; Telegram/WhatsApp provider docs implied; else UNCERTAIN.
> ConvoxOS impl scope: WhatsApp + Telegram. Instagram/Messenger/SMS/Email researched for matrix only.

## 1. Content Block Availability by Channel — VERIFIED (ManyChat Content Block types `14281196200604`)

| Content Block | Instagram | Messenger | TikTok | Telegram | SMS | Email* | WhatsApp** |
|---------------|-----------|-----------|--------|----------|-----|--------|------------|
| Text | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ (native core) |
| Image | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ |
| Delay (typing pause) | ✔ | ✔ | ✔ | ✔ | — | — | ✔ |
| Data Collection | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ (collect_input) |
| File (generic) | — | ✔ | — | ✔ | — | — | — (document) |
| Audio | ✔ | ✔ | — | ✔ | — | — | ✔ |
| Video | ✔ | ✔ | — | ✔ | — | — | ✔ |
| PDF | ✔ | — | — | — | — | — | — |
| Card (image+title+subtitle+buttons) | ✔ | ✔ | — | — | — | — | — |
| Gallery (up to 10 cards) | ✔ | ✔ | — | — | — | — | — |
| Messenger List (opt-in) | — | ✔ | — | — | — | — | — |
| Dynamic block (remote-generated message) | ✔ | ✔ | ✔ (but only Text/Image/Delay/Data) | ✔ | — | — | — (via webhook node) |
| Buttons (inside Text/Card/Gallery) | ✔ (≤3) | ✔ (≤3) | — | ✔ (≤10) | — | — | ✔ (≤3) |
| Quick Replies | — (via buttons) | (buttons) | — | — | — | — | — |
| Lists | — | ✔ (list row) | — | Via inline keyboard transform | — | — | ✔ (≤10 rows) |

*ManyChat Email channel is separate "Emails & SMS" preview note — email automation not supported in In Manychat widget. `VERIFIED` that manychat email automation exists but block types not enumerated per channel — `UNCERTAIN` exact matrix so marked —.
*Manychat WhatsApp text block supports up to 3 buttons (`14281157003292`); Telegram text 10 — applies equally to WhatsApp.

**HighLevel communication actions mapping:** Send Email, Send SMS (generic), Messenger (Facebook), Instagram DM, WhatsApp, GMB Messaging, Live Chat, Call, Slack — similar capabilities but HighLevel lists by action name not per-channel block types.

## 2. Per-Channel Behavioral Contracts

### 2.1 WhatsApp — VERIFIED (ConvoxOS native + ManyChat docs)

- **Send path:** Meta Cloud API via `src/lib/whatsapp/send-message.ts:1` (`sendMessageToConversation`) + `meta-api.ts:1` + `template-send-builder.ts:1`. Requires `whatsapp_config` (phone_number_id, waba_id, access_token, verify_token). `VERIFIED` unified.
- **Message types:** text, image, video, document, audio, template (approved HSM), interactive (buttons up to 3, list up to 10 rows total). `VERIFIED` via `validateFlowForActivation` + `INTERACTIVE_LIMITS` in `meta-api.ts:1` (buttonTitle≤20, listRowTitle≤24, etc.) and ManyChat's same limits.
- **Session window:** 24h customer-care window; outside window only templates allowed. ConvoxOS `src/lib/whatsapp/session.ts:1` enforces; Phase 3 isolated WA window from Telegram. `VERIFIED`.
- **Templates:** Meta-approved fields (category Marketing/Utility/Authentication, language, header_type text|image|video|document, body_text with `{{1}}` params, footer, buttons URL/PHONE/COPY_CODE/QUICK_REPLY). Sync via `/api/whatsapp/config` and `mcp-server`. Rate limits `131030`.
- **Media:** `chat-media` bucket (`016_flow_media.sql`, `023_chat_media.sql`), inbound mirror optional (`mirror_inbound_media` flag), outbound uses public URL Meta fetches.
- **Interactive payload shape:** `InteractiveMessagePayload` discriminated `kind: buttons|list` with `id|title|description` + `body/header/footer` — this is ConvoxOS's canonical shape (`src/types/index.ts:12`, `src/lib/whatsapp/interactive.ts:1`). Used for both automations and flows.

### 2.2 Telegram — VERIFIED (ConvoxOS plug) + ManyChat Telegram block support

- **Send path:** Bot API `sendMessage` / `sendPhoto` / `sendDocument` / `sendVideo` / `sendAudio`/`sendVoice` via `src/lib/channels/telegram/send.ts:1` + `send-media.ts:1`; routing via `chat_id = telegram_chat_id ?? telegram_user_id`; limit 4096 text, 1024 caption; `reply_markup` inline keyboard. `VERIFIED`.
- **ManyChat Telegram blocks:** Text, Image, Delay, Data Collection, Audio, Video, Dynamic, File — per table. Up to **10 buttons per Text block** (`14281157003292` Telegram text 10 vs others 3). Button types channel-dependent but ManyChat shows channel-specific availability (e.g., Call Number Messenger-only).
- **ConvoxOS known mismatch (§38):** Builder stores automation `send_buttons/send_list` as canonical `InteractiveMessagePayload` (WhatsApp shape with `buttons: {id,title}` / `sections: {rows:{id,title,description}}`). Fl  engine transforms to Telegram inline keyboard:

```ts
inline_keyboard: cfg.buttons.map(b => [{ text: b.title, callback_data: b.reply_id }])
// list: flatMap rows → same
```

Automation engine `engine.ts:417` does same mapping via `dispatchChannelText` with `inlineKeyboard`. **But `validateInteractivePayload` runs against WhatsApp limits** (3 buttons) before Telegram path, so a Telegram flow with 6 buttons fails validation even though Telegram supports 10. Also caption vs body mapping diverges. `ChannelSocket.dispatchInteractive:177` reuses `dispatchText` with keyboard for Telegram — routing is correct, payload shape at builder is wrong for TG. **Documented as P0 fix** (see audit). `VERIFIED` from `src/lib/automations/validate.ts:76` + `src/lib/flows/validate.ts:362`.

- **No 24h window,** no template approval — no constraints beyond rate limits. `VERIFIED` via Smart Delay note: "Telegram: No additional setup is required, as this channel does not have a 24-hour window limitation." (`14281197046812`).

### 2.3 Instagram / Messenger — ManyChat primary; HighLevel secondary; ConvoxOS future plug

- **Capabilities (VERIFIED per ManyChat table):** IG/Messenger support Card/Gallery (IG both, Messenger both), Messenger List, File (Messenger only). Delay + Data Collection + Audio/Video + Dynamic. Full button types incl. channel-exclusive (Call Number Messenger-only, Messenger List, etc.). No Telegram file generic via Gallery.
- **Windows:** IG/Messenger have 24h window + 7-day window nuances + OTN/List-driven promo rules (Broadcasts note). ManyChat enforces blocking outside window for promotional broadcasts. HighLevel's Messenger/IG DM actions respect same platform rules implicitly.
- **Auth/triggers:** Comments on Post trigger is FB/IG event category (HighLevel: `Facebook – Comment(s) On A Post`, `Instagram – Comment(s) On A Post`). ManyChat Quick Automations exclusive to IG post/reel comments trigger. `VERIFIED`.
- **ConvoxOS target:** Clone Telegram plug pattern: per-provider `*_config` table, `normalize.ts` → `NormalizedInbound`, extension to `messages.channel CHECK`, inbox `availableChannels` + `Reply via`. No Conversation.channel. P4.

### 2.4 SMS / Email — VERIFIED minimal

- **ManyChat:** Blocks: Text, Image, Data Collection (SMS); Text, Image, Data Collection subset for TikTok-like. Preview: "In Manychat mode does not support testing email or SMS" (`14281198254620`); In messengers mode requires phone/email input, charges apply. SMS keywords `YES/START/STOP` handled by Twilio opt-in/out layer.
- **HighLevel:** First-class actions `Send SMS`, `Send Email` (+ Email Events trigger delivered/opened/clicked/bounced/spam/unsubscribe). Also `Send Slack Message`, `Send Internal Notification`.
- **SMS windows:** No 24h window; governed by DND and STOP handling.
- **ConvoxOS:** No SMS/Email provider today. Scope stays WA+TG. Do not build SMS gateway now.

### 2.5 Cross-channel behavior

- **Channel-neutral automation, channel-aware authoring** — VERIFIED both products:

> ManyChat: "When building your automation, be sure to choose the message block that corresponds to the channel you're focusing on … ensures your messages are optimized." Also: "broadcast can consist of single or multiple linked messages across any channel in any sequence, as long as the channel is activated."

> HighLevel: One workflow can contain actions across SMS, Email, Messenger, IG, WhatsApp, etc. — but builder shows channel-specific blocks locked until connected account exists.

- **Current / inbound channel context:** ManyChat warns trigger/channel mismatch ("selecting a Facebook trigger for an Instagram automation, it will never trigger"). ConvoxOS `Current` = `flow_runs.trigger_channel` / `AutomationContext.trigger_channel` snapshot, `resolveChannelTarget(current → snapshot else error "choose WhatsApp or Telegram explicitly")`. **No silent WA default** — validated via `validate.ts` requiring channel. `VERIFIED` from `src/lib/flows/engine.ts:175` + `src/lib/automations/engine.ts:63`.
- **Cross-channel sends:** ManyChat allows multi-channel sequences inside one automation; ConvoxOS Flow `ChannelTarget` per send node + Automation `channel_target` per step already supports explicit cross-channel; `Current` preserves inbound channel. `VERIFIED`.

## 3. Authoring Restriction Strategy — How Builders Handle Unsupported Content

| Strategy | ManyChat | HighLevel | ConvoxOS target |
|----------|----------|-----------|-----------------|
| **Hide** | Yes — instrument bar shows only blocks available for selected channel node; button types filtered by connected channels. "Available block types depend on connected channels" | Yes — integration-powered steps show locked required fields until account connected; action search shows badges/pricing | **Hide** for fully unsupported (e.g., Gallery on Telegram should be hidden until Telegram Gallery transform is built); disable with tooltip for plan-gated |
| **Disable** | Some — channel-exclusive buttons hidden not disabled | Yes — fields remain locked, step cannot be saved valid | Use for requires-connection |
| **Warn** | Yes — channel mismatch warning ("will never trigger") | Stats Unmatched explains why | Use warning severity `unreachable` / channel mismatch |
| **Validate later** | Preview not execution for Data Collection validation; but save-time validation for required fields | Required fields on Save block publish if incomplete | Enforce at activation/publish; drafts allowed incomplete (`validateFlowForActivation` called before active toggle) |
| **Transform** | Implicit: list→Telegram inline keyboard not offered so gap shows | Not relevant | Explicit transform for WhatsApp buttons/list → Telegram inline keyboard (maps `reply_id→callback_data`, `title→text`, flatten list rows) — must be documented not silent |

**P0 gap:** ConvoxOS hides nothing for Telegram vs WhatsApp beyond `channel_target` dropdown; a WhatsApp-limit validation (≤3 buttons) blocks Telegram builds that would be valid (≤10). Fix: make validation channel-aware per `channel_target` value (not fixed WhatsApp limits).

## 4. Capability Matrix — Canonical (ConvoxOS target)

| Capability | WhatsApp | Telegram | Instagram* | Messenger* | SMS* | Email* |
|------------|----------|----------|------------|------------|------|--------|
| Text | ✔ | ✔ 4096 | ✔ | ✔ | ✔ 160 | ✔ |
| Image | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Video | ✔ | ✔ | ✔ | ✔ | — | — |
| Audio/Voice | ✔ (audio) | ✔ (audio/voice) | ✔ | ✔ | — | — |
| Document / File | ✔ doc | ✔ doc | — / PDF | ✔ File | — | — |
| Buttons | ✔ ≤3 | ✔ ≤10 | ✔ ≤3 | ✔ ≤3 | — | — |
| Lists (rows) | ✔ ≤10 total | ✔→keyboard | — (Card/Gallery) | ✔ | — | — |
| Card / Gallery | — | — | ✔ | ✔ | — | — |
| PDF | — | — | ✔ | — | — | — |
| Messenger List | — | — | — | ✔ | — | — |
| Templates (approved) | ✔ required | — | — | OTN/List | — | — |
| Quick replies | via buttons | via keyboard | via buttons | via buttons | — | — |
| Typing indicator | ✔ | — | — | ✔ | — | — |
| Input collection | ✔ collect_input | ✔ | ✔ | ✔ | ✔ | ✔ form |
| Inline keyboard | — | ✔ via markup | — | — | — | — |
| 24h window | ✔ | — | ✔ +7d | ✔ +7d | DND only | — |

*Research matrix only; not implementation scope. Verified where docs cover.

## 5. Target Channel Model Summary

- **One `Channel` enum** (`whatsapp|telegram|instagram|messenger|sms`) stored as `messages.channel` with CHECK — adding INSTAGRAM/MESSENGER is a migration adding enum value (existing pattern `041→042`).
- **Per-contact identity:** `phone` (WA), `telegram_user_id`+`telegram_chat_id`, future `instagram_user_id`/`messenger_user_id`, null allowed per contact (one row per person per account).
- **Trigger filtering:** `channel: any|whatsapp|telegram` (future any|instagram|messenger) on inbound triggers (`flows.trigger_config.channel`, `automations.trigger_config.channel`) — any passes, specific enforces match; no context → pass (manual).
- **Send targeting:** `channel_target: current|whatsapp|telegram` per send node; legacy null → whatsapp for compat; current requires snapshot else hard error ("choose … explicitly") — no silent fallback.
- **Socket:** `src/lib/channels/socket.ts:65 dispatchText, 110 dispatchMedia, 177 dispatchInteractive` stays thin; provider logic in `whatsapp/*` and `telegram/*`.
- **Builder hide/disable:** Channel-specific block allowlist + per-target limit table (buttons≤3 vs ≤10) drives instrument bar + panel options.

*ConvoxOS already at ~90% of this contract; remaining gap is channel-aware validation (P0) + matrix docs + future plug scaffolding.*
