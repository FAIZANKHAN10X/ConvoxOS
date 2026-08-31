# ManyChat Pro — Product Model (Research: 2026-08-31)

> **Sources:** `https://help.manychat.com/` primary. Accessed 2026-08-31. Live-crawl preferred.
> Classification per claim: VERIFIED (official doc) / INFERRED / UNCERTAIN / NOT DOCUMENTED.

## 1. Automation Product Structure — VERIFIED

### 1.1 Entry points

| Area | Location | Behavior |
|------|----------|----------|
| **My Automations** | `Automations > My Automations > + New Automation` | Primary hub. Lists all custom automations. Filter/sort by trigger and trigger state (active/disabled). Search by triggers. |
| **Start From Scratch** | `+ New Automation > Start From Scratch` (upper right) | Blank canvas. Full control. |
| **Templates** | `+ New Automation` pop-up shows ready-to-go templates | Pre-built flows for common use cases. Selecting a template clones into canvas; not a live reference. |
| **Basic section** | `Automation tab > Basic` | Houses essentials: Default Reply, Welcome Message, Conversation Starters, Main Menu, Story Mention Reply, Greeting Text, etc. Coupled with custom automations; indicated in Starting Step when linked. |
| **Quick Automations** | `Automation tab` — currently **Instagram post & reel comments trigger only** | Simplified streamlined alternative that integrates with Basic + Flow Builders. Not a separate engine — compiles into same automation model with fewer steps. |

Source: `https://help.manychat.com/hc/en-us/articles/14281166306332` (How to build a Manychat automation, 2025-12-03) and `https://help.manychat.com/hc/en-us/articles/14281111044124` (Automation tab Overview, 2025-12-01)

### 1.2 Organization

- **Folders & naming:** Users organize via folders and naming conventions (recommended for large accounts). No hard limit on automation count documented. `VERIFIED` — FAQ: "no strict limit".
- **Draft / Published / Active:** `Set Live` publishes. Automations can be active/inactive per trigger (trigger state filter). Deactivation stops future enrollment but does not retroactively remove waiting contacts — see §5.
- **30-block pause rule:** `VERIFIED` — "A single automation can include up to 30 blocks without a pause for each subscribed contact. If the flow exceeds this limit, it will pause automatically to prevent overloading. Any block without a button or Smart Delay is considered a block without a pause." This is execution-level flow control, not just validation.
- **Reusability:** Via **Start Automation** (see §3.7), folders/naming breaking large automations into smaller reusable ones is the documented pattern.

### 1.3 Basic Builder vs Flow Builder — VERIFIED: Two views over one canonical model

> **Finding:** They are **different interfaces over the same canonical automation definition**, not separate models.

Evidence (`14281166306332`):

- Header toggle `Flow Builder ↔ Basic Builder` (item 5) — "Switching back and forth allows you to choose the most suitable view for your workflow."
- FAQ: "Yes, you can switch back to the Basic Builder at any time by clicking Go to Basic Builder while in editing mode."
- Basic = linear message-by-message view, "excellent for simpler automations" but "limiting for complex".
- Flow = bird's-eye visual map showing all messages, actions, transitions; ideal for complex.

Implication for ConvoxOS: **One canonical definition, two editors**. Basic editor serializes to same graph but renders linearly and hides/rejects complex branching. Do NOT delete either; they serve different complexity levels. ConvoxOS's current `Basic Builder` vs `Flow Builder` divergence should converge on one persisted graph.

### 1.4 Keywords, Sequences, Broadcasts, Rules — VERIFIED

| Feature | Where | Behavior |
|---------|-------|----------|
| **Keywords** | `Automation > Keywords` tab + `+ New Trigger > User sends a message` inside builder | Two setup paths same effect. Rules: `Message is` (exact, case-insensitive, any extra word/symbol blocks it), `Message contains` (substring), `Message contains like` (word-boundary aware, distinguishes hi/within), `Message begins with`, `Message is Thumbs Up` (Messenger-only reaction), `Message doesn't contain` (exclusion), plus `+Message condition` (compound keywords). Up to 10 keywords per rule, Free limit 3 custom triggers, priority by list order (first matching wins), `Default Reply` if no keyword matches. Also supports AI intent ("recognize intention" — describe intent, AI matches). Channel selection required; SMS opt-in/out keywords (`YES/START/STOP`) handled by Twilio layer not ManyChat automation. |
| **Sequences** | `Automation > Sequences` | Time-series: each message individually enabled; if ≥1 enabled, sequence is online. Delays: immediate or minutes/hours/days after subscription (first) or after previous message. `Send between` time window limits delivery. Enrollment: Action block `Subscribe to sequence` on button, Bulk action in Contacts tab, or contact profile. Stats cover stuck/not-subscribed/timing/duplicate issues (condition/no-follow-up, Smart Delay interplay, Data Collection 30-min pause, unauthorized links). |
| **Broadcasts** | `Broadcasts` section + `Broadcast From Automation` | Two creation modes: scratch or pick existing automation (cloned — edits don't affect original). Single or multi-step, any channel if activated. Audience: conditions (gender, tags, name, activity, language, timezone, etc.). Promotional broadcasts respect 24h window (needs Lists/One-Time Notifications outside). Scheduling: Send Now or scheduled date/time; recipient list finalized at *send* time (not schedule time) — tag growth between schedule and send is included. Platform compliance: ManyChat blocks untagged message outside 24h window. |
| **Rules** | `Automation > Rules` (formerly Triggers) | Global `if trigger then actions (+ optional conditions)`. Triggers: Date/Time (contact timezone, exact/before/after a date/datetime custom or system field, optional time override), Log conversion event (Pixel), Tag applied/removed, Subscribed/Unsubscribed to sequence, Custom field value changed, System field value changed, New contact (not re-subscribed). Multiple triggers per rule (OR). Multiple actions per rule (same catalog as flow Action step + Start Automation). Conditions gate execution (e.g., subscribed before date). Bulk Actions do NOT fire tag-applied rules (anti-spam). Updating system/custom field via bulk *does* fire its rule. |

Sources: Keywords `14281211785884` (2026-02-17), Sequences `14281202572316` (2025-12-03), Broadcasts `14281228205212`, Rules `14281170185628` (2026-08-27), Automation tab overview `14281111044124`.

---

## 2. Builder UX — Interaction Model — VERIFIED

### 2.1 Canvas & Navigation

- **Canvas:** Visual map; auto-arrange button neatly organizes; zoom In/Out + fit-to-screen; pan via drag; minimap implied for large flows (ManyChat doesn't document minimap explicitly — `VERIFIED` for zoom/pan/auto-arrange, `UNCERTAIN` for minimap presence vs HighLevel).
- **Node creation:** + icon → instrument bar with all blocks; or double-click empty canvas → pick step type; or round button upper-right corner. `VERIFIED`.
- **Node placement/movement:** Drag handle on node; select multiple via Shift+click or Shift+drag frame; `VERIFIED` via Tips.
- **Connections:** Click connection dot on step → drag line to target step. Change Starting Step's first target by dragging dark dot connector. `VERIFIED`.
- **Editing:** Header: rename automation, undo/redo (also Cmd+Z / Cmd+Shift+Z), Preview, Set Live, ⋮ menu. Right sidebar: toggle Flow/Basic, instrument bar, zoom. Footer: zoom/pan help, AI Flow Builder Assistant entry. Node: duplicate (□) + delete (🗑) icons appear on hover.
- **Copy/paste:** `Cmd/Ctrl+C / V` inside same or across automations *and between accounts*; Alt+drag creates copy. Cross-account paste may disable actions if target lacks Tags/Sequences. `VERIFIED`.
- **Selection, deletion, duplication, undo/redo:** All covered above; undo/redo both via buttons and keyboard.

### 2.2 Validation & States

- **Up to 30 blocks without pause** — auto-pause at execution, not a save-time block (see §1.2).
- **Channel mismatch:** `VERIFIED` — "Selecting a trigger that doesn't match the automation's channel — e.g., Facebook trigger for Instagram automation — it will never trigger." Builder warns but does not prevent save; execution validates at trigger time (channel-specific listening).
- **Incomplete nodes:** Not explicitly documented as a visual state, but preview limitations and Tips imply inactive/warning state when block lacks required fields (e.g., condition without follow-up breaks sequence message). No formal "incomplete node" badge documented — `UNCERTAIN` for exact visual language.
- **Validation on publish:** Not separately documented as a blocking step; publish is `Set Live` after preview. Saving draft with incomplete config is allowed (inferred from preview needing restart after modification). `INFERRED`.

### 2.3 Preview / Publish / Execution Viz — VERIFIED

See §8 for full detail. Summary:

- **Preview modes:** `In Manychat` (smartphone widget inside builder, no external app) vs `In messengers` (native app). `In Manychat` limitations documented in detail. `In messengers` requires login; supports real data, integrations, SMS/Email (with phone/email input).
- **Analytics in automation view:** Shows per-step stats, drop-off, which parts need improvement; filterable by trigger. `VERIFIED`.
- **Smart Delay stats:** `Overall / Waiting / Passed` with Total + Unique per block.
- **No versioning documented** for ManyChat automations beyond undo/redo and restart prompt; unlike HighLevel's Version History. `NOT DOCUMENTED`.

### 2.4 AI Builder

- **AI Flow Builder assistant** — bottom chat window: describe business → goals (leads/engagement/appointments) → pick channel (IG/Messenger/WhatsApp/Telegram) → pick template or Other → pick trigger → AI generates up to 30s → `Use Automation` or `Back To Chat` / `Start from Scratch`. `VERIFIED` via `14281200017948`. Best practices: clear description, specific goals, review/customize, test before publishing, iterate.

---

## 3. Node / Block Catalog — Behavioral Cards

> For each, fields marked `VERIFIED` come from official docs; `UNCERTAIN` flagged.

### 3.1 Message Block (Content Node) — VERIFIED

- **Category:** Communication (container).
- **Visual:** Channel-specific node (e.g., "Messenger message", "Instagram message") showing stacked content blocks inside.
- **Config UI:** Inside node: add blocks via `More` or direct; each block has X (delete) + duplicate icons; drag handle (arrow turns blue) to reorder. Add multiple blocks, identical or different, inside one node — they send sequentially as one payload where channel allows.
- **Content blocks per channel (VERIFIED from Content Block types `14281196200604`, updated 2026-03-19):**
  - Instagram: Text, Image, Delay, Data collection, Audio, Video, PDF, Card, Gallery, Dynamic
  - Messenger: Text, Image, Delay, Data collection, Audio, Video, Card, Gallery, Dynamic, File, Messenger List
  - TikTok: Text, Image, Delay, Data collection
  - Telegram: Text, Image, Delay, Data collection, Audio, Video, Dynamic, File
  - SMS: Text, Image, Data collection
- **Required:** At least one content block; channel selection (implicit by node type).
- **Optional:** Multiple blocks, button attachments (channel-limited).
- **Variables:** `{{user fields}}` interpolated in Text blocks and button titles (buttons allow variables, ≤20 chars total).
- **Inputs/Outputs:** Single input edge; single or branched outputs (see Buttons below).
- **Branch behavior:** If node contains buttons/quick replies, each button creates its own output handle; otherwise single `next` edge.
- **Channel limitations:** Strict per table above. Builder shows only blocks available for selected channel's node type — `VERIFIED`: "choose the message block that corresponds to the channel … ensures messages are optimized."
- **Validation:** Text required; Image/Video/Audio file required; Card/Gallery require image+title/subtitle; Dynamic requires Request URL + method. Not all validated at save — preview catches some.
- **Runtime:** Sends as native channel payload. Delay block inside adds typing pause (with optional typing indicator per channel).
- **Wait:** Does NOT suspend execution unless it ends with buttons expecting reply (then flow pauses) — tied to next block type.
- **CRM effects:** None direct; content blocks don't write CRM.
- **Exec viz:** Per-message delivery.
- **Testing:** Previewable in both modes (except SMS/Email limited in In Manychat).

### 3.2 Buttons — VERIFIED

- **Category:** Communication / Interactive.
- **Visual:** Inside Text/Card/Gallery block: row of pill buttons.
- **Config:** `+ Add Button` per block; each needs name ≤20 chars (emoji+variables allowed). To remove, click button → Remove.
- **Channel-specific limits (VERIFIED `14281157003292`):**
  - Messenger, Instagram, WhatsApp Text blocks: up to **3 buttons**
  - Telegram Text blocks: up to **10 buttons**
  - Card/Gallery buttons: per card item + global limits (Gallery up to 10 cards, each image + optional buttons)
- **Button types (channel-dependent):**
  - Channel buttons (link, call, etc. — Call Number Messenger-only)
  - Perform Actions (tags, user fields, conversion logging)
  - Smart Delay
  - Start another Automation
  - Select Existing Step (next node)
- **Connection semantics:** Each button `next_node_key` is an edge; builder requires "add the next block that will trigger after contact clicks button."
- **Validation:** Title required ≤20 chars; next node required; channel capabilities checked (e.g., Call Number hidden on Instagram). `VERIFIED` — "Available button types depend on connected channels and channel of the text block."
- **Runtime:** Telegram → `inline_keyboard` with `callback_data = reply_id`; WhatsApp/Messenger → native interactive payload. In ConvoxOS verified bug: builder stores WhatsApp-shaped payload shape without Telegram conversion — Telegram `answerCallbackQuery` + `inlineKeyboard` mapping works but builder payload lacks it.
- **Channel hiding:** Builder hides unsupported types; does not show disabled ones. `VERIFIED` — "only available options vary depending on connected channels."
- **Failure:** Missing next node = dead end; 30-block pause rule applies.

### 3.3 Quick Replies — VERIFIED (via Buttons/Data Collection distinction)

- Effectively buttons without persistent UI; limited to Messenger/Instagram Text blocks historically. ManyChat docs group quick replies under button behavior for Telegram/WhatsApp equivalence. `INFERRED` — exact quick reply vs button taxonomy is not consistently separated in 2026 docs.

### 3.4 Image / Video / Media / Audio / File / PDF / Card / Gallery — VERIFIED

- **Image:** Upload or URL. **Video/Audio:** Formats/size per `Media guidelines for Facebook Messenger, WhatsApp, and Instagram automations` `14281167455388`. **File:** generic attachment. **PDF:** preview in chat. **Card:** image + title + subtitle + optional buttons. **Gallery:** up to 10 images each with optional buttons.
- **Channel mapping:** See §3.1 table. Telegram supports File (generic) while Instagram does not; SMS supports only Text+Image.
- **ConvoxOS target:** Media nodes must be channel-aware; Telegram `sendMedia` handles image|document|video|audio|voice via public `chat-media/telegram` URL; WhatsApp via `chat-media`. Caption limits apply (1024 chars Telegram, WhatsApp interactive body cap).

### 3.5 Delay (inside message) vs Smart Delay (standalone) — VERIFIED

- **Delay content block:** Typing pause inside a message node; optional typing indicator per channel; does NOT suspend automation beyond natural pause; no configuration beyond duration + indicator toggle. Channel availability per §3.1.
- **Smart Delay block:** Standalone execution control (see §5.2). Different semantics — don't conflate.

### 3.6 Data Collection — VERIFIED via `14281167138588` + preview limits

- **Purpose:** Collect email, phone, free text, multiple choice, image uploads (limited) into Custom User/Bot Fields.
- **Config:** Select field to store, reply type (free text / multiple options / phone / email), validation rules, "If contact has not responded" timeout branch (cannot be previewed in In Manychat mode). Multiple-choice options each become branches.
- **Runtime:** Pauses automation awaiting reply, **up to 30 minutes** (documented in sequence troubleshooting: "automation will pause in a Data Collection block and wait for contact's response for up to 30 minutes"). Until completed or timeout, automation won't proceed.
- **In Manychat preview:** Input validation NOT enforced; image uploads not supported; Multiple Choice + not-responded behavior cannot be previewed. `VERIFIED`.
- **Channel support:** Text-based; available across channels per §3.1 table (all except TikTok's extra restrictions).
- **CRM effects:** Writes Custom User/Bot Fields; can be queried by Condition.
- **Visualization:** Waiting state per contact (30-min window).

### 3.7 Condition Block — VERIFIED (`14281142518556`, 2026-08-12)

- **Category:** Logic.
- **Visual:** Diamond/branch node splitting into matching vs non-matching paths.
- **Config:** `Does the contact match: all / any`. Add one or more conditions with AND/OR. Available filters:

**General filters:** Tag, Opted-in through widget, Opted-in through ad (FB Ads created in Ads tab), WhatsApp CTWA caveat (use Tag/User Field instead), Opted-in through API, Messenger List subscription (available now / subscribed), Sequence subscription, Current time (account timezone, with time zone management article), Segments (predefined).

**Fields:** System Fields, Custom User Fields, Custom Bot Fields — with date/datetime offset formulas (e.g., coupon date > issuance + 3 days).

- **Inputs:** Single.
- **Outputs:** Two: matching path + non-matching path (`true_next` / `false_next` in ConvoxOS). No implicit fallthrough.
- **Connection rules:** Both branches must have a target for deterministic flow; missing target = message not fully sent (documented in sequence troubleshooting: "If there is no follow-up after a condition, that message in the sequence won't be fully sent.").
- **Validation:** At least one condition + both branches connected `UNCERTAIN` for save-time enforcement (observed warning level).
- **Runtime:** Evaluated instantly against contact state; does NOT suspend.
- **CRM effects:** Read-only; does not mutate.
- **Exec viz:** Branch label + matched vs not.
- **Preview:** In In Manychat mode, conditions cannot be evaluated automatically — you manually choose path. `VERIFIED`.

### 3.8 Randomizer — VERIFIED (`14281151100060`, 2025-11-27)

- **Purpose:** Split traffic A/B (contests, experiments, personalized experiences).
- **Config Up to 6 variations**, each percentage via slider. Checkbox `Random path every time`.
  - **Unchecked (default):** Sticky assignment — first time contact reaches block, group A/B/C assigned; same path ever after for that contact on re-entry.
  - **Checked:** Random every time — no stats reference, natural distribution.
- **Distribution quirk (VERIFIED):** With unchecked and large numbers, batch distribution can skew (1000 example: 200 A, 200 B, 200 C, then 200 A, 200 B — final A/B 400, C 200). Recommendations: use unchecked for ongoing (quiz/sales/tournament) — gradually evens out; use checked for one-time broadcasts.
- **Inputs/Outputs:** Single input, 2–6 branch outputs each with percentage label.
- **Validation:** At least 2 variations; percentages must sum to 100% (inferred from slider UX). Not documented as save-blocker.
- **Runtime:** Immediate random or sticky lookup.
- **Persistence:** Unchecked persists assignment per contact (implied persistent mapping, not documented where stored). `INFERRED` — likely contact-level bucket.
- **Exec viz / Analytics:** Branch counts per path; not shown as typed metrics beyond distribution.

### 3.9 Smart Delay — VERIFIED (`14281197046812`, 2025-12-03)

- **Two types:**
  - **Duration:** Amount + unit (minutes/hours/days) + optional `Set continue time limit` (Continue between hours, e.g., 8:00–22:00) + optional day filter (Any Day / specific days). `Choose Next Step` after delay.
  - **Date:** Specific Date (exact datetime) or Dynamic Date (date from Custom User Field ± offset in min/hours/days).
- **Contacts timezone:** Uses contact's timezone, else account timezone. `VERIFIED`.
- **Admin pause caveat:** If admin pauses automation (e.g., sends message to contact), pause duration added to Smart Delay time. `VERIFIED`.
- **Stats:** Overall (entered), Waiting (currently delaying), Passed (completed → next step), with Total+Unique on click. `VERIFIED`.
- **24h window Caveat (VERIFIED):** Smart Delay does NOT reopen 24h window. If contact enters Smart Delay >24h then regular message after will not deliver. Workarounds: IG/Messenger use special message block types (per `14281199732892`), WhatsApp use Message Template, Telegram no limitation.
- **System:** Does suspend execution; waiting state per contact visible in stats. Sequence+Smart Delay interaction can cause message interleaving if both schedule messages concurrently (documented in sequence troubleshooting).

### 3.10 Start Automation (Start Another Flow) — VERIFIED (`14281157602716`, 2025-11-27)

- **Purpose:** Modular reuse — call another automation from current one, reducing redundancy.
- **Config:** `Click to Select Automation` → `Pick This Automation`. Then connect via dot → drag to next step (post-automation continuation).
- **Runtime (VERIFIED critical semantics):** "An automation connected through the Start Automation step will send all the messages before returning to the initial automation. However, it will not pause to wait for the contact's input on messages with buttons or quick replies." — i.e., callee runs synchronously through its message nodes but **skips input-waiting** (no suspension for button/reply). After callee completes, caller resumes at its next node.
- **Connection:** Single input, single `next` after callee; callee選定 by reference (not copy).
- **Failure:** Referenced automation deleted → link breaks (behavior `UNCERTAIN` — likely block shows missing reference warning).
- **Validation:** Requires selected automation exists.

### 3.11 Actions — VERIFIED (`17636378650268`, 2026-02-17)

Categories (official):

- **Contact data:** Add/Remove Tag, Set/Clear User Field, Delete Contact, Set Channel Opt-in/Opt-out
- **Automation:** Set Bot Field, Subscribe/Unsubscribe to Sequence, Make External Request (HTTP), Change Menu in Messenger, Log Conversion Event
- **Inbox:** Mark conversation as Open/Closed, Assign conversation (specific member/group), Notify Assignees (email/SMS; Notify Admins via Messenger temporarily unavailable per FB policy)
- **Ads Optimization:** Send event to Meta Conversions API
- **Integrations:** Any connected integration's actions (Zapier/Google Sheets/etc.) appear here
- **Properties:** An Action block can contain **multiple actions** as tasks within one block (see tutorial: "Each Actions step can include multiple tasks"). Not limited to one per block.
- **Channel specificity:** Some actions channel-limited (e.g., Change Menu is Messenger-only). Builder filters by channel.

### 3.12 Dynamic Block / External Request — VERIFIED

- **Dynamic Block** (`14281268533788`): Inside content node. Config: Request type POST/GET/PUT/DELETE, HTTPS URL, headers, body. `Test Request` with contact. **Fallback step** optional — automation follows fallback on error; without fallback, error is silent but logged in `Settings → Logs`. Response must match ManyChat's expected message format per `manychat.github.io/dynamic_block_docs` (channel-specific pages).
- **External Request Action** (`14281285374364`): Similar but as Action block (not content). Both allow HTTP integration.

### 3.13 Comments / AI

- **Comments:** Growth Tools / Instagram Post & Reel Comments trigger not fully covered here; Quick Automations currently exclusive to IG post/reel comments trigger.
- **AI Flow Builder Assistant:** Chat-based generator (see §2.4). Also **Intention-based keyword** (describe intent, ManyChat AI matches message to description) — under Keywords → intention option.
- **AI Text Generation:** Not separately block-typed in 2026 docs beyond assistant; no dedicated AI decision node like GHL's AI Prompt — `NOT DOCUMENTED` as standalone block.

---

## 4. ManyChat ↔ HighLevel Overlap / Differences (for ConvoxOS mapping)

| Dimension | ManyChat | HighLevel |
|-----------|----------|-----------|
| **Sequence** | Product concept: subscribers to time-series of messages with per-message on/off + delays; triggered via Tag/Action/Bulk/contact profile; distinct from automation flow blocks | Not a named object; equivalent is drip via Wait chain inside Workflow (Wait steps achieve same) — no top-level Sequence entity |
| **Broadcast** | Campaign object: audience segmentation + channel selection + Send Now / schedule; recipient list frozen at send-time; clone from automation | Broadcast replaced by Workflow with SMS/Email sends + triggers; no dedicated Broadcast object (Campaigns legacy) |
| **Rules (global triggers)** | Global if-then outside flows: date/time, tag, sequence sub/unsub, field changed, new contact → actions | Is Workflow Trigger itself (every trigger is global inside workflow definition); no separate global Rules tab |
| **Data Collection** | Dedicated block, 30-min wait, channel-agnostic | No equivalent — Input collected via Forms/Surveys as inbound triggers; not inline flow pause |
| **Randomizer** | Up to 6 branches, sticky vs every-time | Split test action inside Workflow (A/B split) |

---

## 5. Builder → Persistence → Execution Lifecycle — INFERRED + VERIFIED fragments

| Stage | ManyChat behavior | Evidence |
|-------|-------------------|----------|
| **Builder** | Canvas with channel-specific Starting Step (trigger picker). Blocks added sequential; each button branch creates edge. Auto-arrange available. | `14281166306332` Tips/sec 9 |
| **Save** | Draft allowed with incomplete graph (preview restart prompt implies live editing). | Inferred from preview "modify while previewing → restart suggestion" |
| **Validate** | Channel mismatch warning ("will never trigger") but not hard block; keyword required warnings. Condition missing follow-up warned in sequence troubleshooting. 30-block limit enforced at runtime not save. | `14281166306332` ⚠️ Note + FAQ |
| **Publish** | `Set Live` button top-right; preview modes before publish recommended. | `14281166306332` final step |
| **Active** | Waiting contacts: Smart Delay stats show Waiting/Passed; Data Collection pauses 30 min. Sequence messages individually enabled. | `14281197046812`, `14281167138588` implied |
| **Edit active** | Auto-restart prompt on modify while previewing; for live automations, editing does not retroactively change waiting contacts' delay distribution (batch quirk noted). New contacts follow new definition. | Preview docs + Randomizer batch note |
| **Preview/Test** | In Manychat (widget, no login, limited: no contact/third-party data, no Dynamic/Google/Zapier, only current automation, no Actions/Smart Delay/Start Automation display or execution, no input validation, no SMS/Email, no Multiple Choice/not-responded, conditions manual) vs In messengers (native app, login required, full execution incl integrations, SMS/Email phone/email input, charges apply). | `14281198254620` |
| **Execution history** | Automation view stats (per-step drop-off, filterable by trigger), Smart Delay Overall/Waiting/Passed. No version history documented. | `14281166306332` FAQ + `14281197046812` |
| **Channel publish** | Channel mismatch = trigger never fires; Smart Delay >24h requires template/list/notif for Messenger/IG, template for WhatsApp, none for Telegram. | `14281197046812` |

---

## 6. What ManyChat Pro Means for ConvoxOS — Contract Implications

1. **Single canonical automation graph with dual editors** — ConvoxOS should persist one graph (`flows + flow_nodes` or `automations + automation_steps` unified) with Basic as linear view adapter, not duplicate models.
2. **Channel-aware authoring, channel-neutral execution** — Builder shows only channel-supported blocks/buttons (per-channel allowlist). At publish, validate `channel_target` per send node (current|whatsapp|telegram + future). Execution resolves `current → trigger_channel snapshot` else explicit. Exactly what ConvoxOS Phase 6 ships (`flow_runs.trigger_channel` + `channel_target` + `ChannelSocket`).
3. **Pause semantics = input-waiting or Smart Delay** — Any node with buttons/quick replies or Data Collection suspends; Smart Delay suspends with timer+window; plain Message does not. 30-block limit without pause → auto-pause enforced server-side (ConvoxOS currently has `Wait` node + fallback `fallback.ts` reprompt/handoff but not 30-block cap — gap P1).
4. **Sequences ≠ automations** — ConvoxOS sequences should be target top-level domain objects (subscribed contacts + per-message enabled + delays + windows), not just wait nodes, to match ManyChat parity for drip campaigns.
5. **Broadcasts = audience-segmented sends (clone from automation allowed)** — Keep `broadcasts`/`broadcast_recipients` template-based; extend to audience conditions and channel selection before claiming ManyChat parity.
6. **Rules = global triggers vs in-flow triggers** — ManyChat Rules are global tag/field/sequence/date triggers. ConvoxOS's `automations.trigger_type = tag_added` already covers part, but date/time-based (`time_based` with schedule) is only in automations, not globally as Rules — consider unifying.

---

*Evidence URLs recorded; classification applied. Next: HighLevel model → builder UX → channel behavior → specs.*
