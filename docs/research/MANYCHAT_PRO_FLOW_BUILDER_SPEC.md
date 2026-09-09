# Manychat Pro Visual Automation Builder — Deep Parity Spec (2026-09-02)

> **Status:** Research + Specification only. No implementation.
> **Target:** Manychat Pro as of **2026-09-02** (official docs live-crawled 2026-08-31–2026-09-02). Channel: Instagram / Messenger / WhatsApp / Telegram / SMS / TikTok. Plan: Pro (+AI add-on where noted).
> **Convox anchor:** Graphify index at `graphify-out/graph.json` (3651 nodes, 2026-09-02) + existing Convox specs `docs/specs/node-system.md:1`, `docs/research/manychat-model.md:1`, `docs/research/builder-ux-model.md:1`, `docs/specs/channel-capabilities.md` (canonical matrix).
> **Classification per claim:** `VERIFIED` = official Manychat Help Center; `OBSERVED` = UI/behavior documented in tutorials/community with screenshots; `INFERRED` = derived from multiple fragments; `UNCERTAIN` = conflicting or absent evidence; `NOT DOCUMENTED` = no source found.

---

## 1. Executive Summary

Manychat's builder is **one canonical automation graph with two editors**, not two engines.

- **Flow Builder** = visual map (bird's-eye), ideal for branching. **Basic Builder** = linear message-by-message view, ideal for simple sequences. Header toggle switches views over the **same** persisted automation — `VERIFIED` (`help.manychat.com/hc/en-us/articles/14281166306332`, FAQ: "Yes, you can switch back at any time").
- **Starting Step** is an envelope (not a graph node) holding **triggers**. Triggers are channel-specific and gate enrollment. `+ New Trigger` on the Starting Step is the entry point.
- **Message block** is a *container* holding **Content Blocks** (Text, Image, Delay, Data Collection, File, Audio, Video, PDF, Card, Gallery, Messenger List, Dynamic). One Message node can hold multiple content blocks that send sequentially. Channel determines which content blocks are offered.
- **Six top-level block families** on the canvas: **Message** (container), **Action** (multi-task), **Condition**, **Randomizer**, **Smart Delay**, **Start Automation**. Plus **AI Step** (Pro+AI add-on) and **Data Collection** (content block that pauses 30 min). This matches the instrument bar order observed in `36000105060-flow-builder` (`+` → instrument bar → pick block type; double-click empty canvas → pick).
- **Edges** are heterogeneous: sequential `next`, button/row branches (`reply_id → next`), condition branches (matching vs not), randomizer branches (N waypoints with %), Smart Delay single `Choose Next Step`, Start Automation single continue after callee. Branch merging, duplicate reply_ids, unreachable nodes, 30-block-without-pause, channel-mismatch warnings are the validation core.
- **Pause semantics are load-bearing:** any block with buttons/quick replies or Data Collection *suspends* waiting for contact input (Data Collection ≤30 min). Smart Delay *suspends* with timer + continue-time window. Plain Message does **not** suspend. Counter: `A single automation can include up to 30 blocks without a pause ... will pause automatically` — `VERIFIED`.
- **Runtime model:** `Trigger → Execution (contact-scoped) → Node → State → Next edge → Node`, with `Current` channel snapshot, wait timers, sticky randomizer buckets, condition manual override in preview, and 24h window caveat after Smart Delay (>24h regular message won't deliver; workaround channel-specific — `VERIFIED` `14281197046812`).
- **Pro scope (2026-03-02 pricing):** Pro = $29/mo (annual) for 2,500 Active Contacts, up to 3 channels, unlimited automations; **AI Step is an extra $29/mo add-on to Pro** (`NOT bundled` — `VERIFIED` `creatorlanehq.com/blog/manychat-pricing-explained-2026` + `manychat.com/product/ai` "*AI only available as add-on to Manychat Pro*"). Additional Inbox seats $25. Free caps at ~1,000 contacts (observed; some Help pages still show 25 — pricing churn, see §21).
- **Biggest Convox gaps:** dual-engine divergence (Automations sequential vs Flows graph, no single canonical graph), 30-block pause not enforced, continue-time windows on Wait not implemented, Smart Delay `Date` (Specific/Dynamic) not implemented, Randomizer sticky bucket persistence not formalized, multiple triggers OR per automation, Sequences as first-class domain object, Broadcast audience builder, global Rules parity, per-step analytics, channel-aware button limits (TG 10 vs WA 3) validation mismatch (Convox recently fixed for automations but Flows `send_list` still WA-only), and Pro entitlement gating.

---

## 2. Manychat Builder Mental Model

### 2.1 Automation = Envelope + Graph

```
Automation (My Automations > + New Automation > Start From Scratch)
├── Starting Step (rounded pill at top, trigger chips + channel badge)
│   └── Triggers ( + New Trigger → pick event + configure + toggle active)
│       ├── Instagram: Post/Reel comments (with keywords), Story reply, Story mention, DM
│       ├── Messenger: Keywords (User sends a message), Comment, Ad click
│       ├── WhatsApp: Keywords, Click-to-WhatsApp ad, Template reply (OBSERVED)
│       ├── TikTok: Text/Image/Delay/Data Collection only (limited)
│       ├── Telegram: Text/Image/Delay/Data Collection/Audio/Video/Dynamic/File
│       └── SMS: Text/Image/Data Collection
├── Canvas (infinite, zoom/pan/auto-arrange, minimap UNCERTAIN)
│   ├── Message (container → 1..N Content Blocks)
│   ├── Action (1..N tasks in one block)
│   ├── Condition (matching vs not — 2 outputs)
│   ├── Randomizer (2–6 variations, now up to 12 — see §9)
│   ├── Smart Delay (Duration or Date)
│   ├── Start Automation (call + single continue)
│   ├── AI Step (Pro+AI: goal+context+tasks, chat preview)
│   └── Data Collection (content block inside Message that pauses; also a standalone concept)
├── Toolbar (rename, undo/redo, Preview, Set Live, ⋮)
├── Right sidebar (Flow/Basic toggle, instrument bar, zoom)
└── Bottom (AI Flow Builder Assistant chat — 8-step wizard)
```

`VERIFIED` for envelope/graph split from `14281166306332` (Starting Step + "Select the first block... could be a message, action, or condition") and `14281111044124` (Automation tab overview).

### 2.2 Two Views, One Model

ManyChats docs frame Basic and Flow as views, not models — `VERIFIED` FAQ toggle description. Implication: persist **one** graph; render Basic as linear adapter that hides/rejects branching. Convox currently persists **two** models: `automations/automation_steps` (sequential positions + `yes`/`no` branches) and `flows/flow_nodes` (graph `node_key` + `next_node_key` inside config). Both are real engines (`src/lib/automations/engine.ts:1`, `src/lib/flows/engine.ts:1`). Gap: reconcile to single canonical graph or formal bridge (see §26).

### 2.3 Pause is a Graph Property

`A single automation can include up to 30 blocks without a pause ... Any block without a button or Smart Delay is considered a block without a pause.` — `VERIFIED`. Execution pauses at **buttoned message**, **Data Collection**, **Smart Delay**, or **Start Automation callee return**. This is why connection rules and runtime diverge: some nodes suspend, some auto-advance.

### 2.4 Channel is Authoring-Time Filter + Runtime Snapshot

Builder **shows only** blocks/buttons valid for selected channel node type (`VERIFIED` `14281196200604` per-channel allowlist + `14281166306332` "choose the message block that corresponds to channel ... ensures messages are optimized"). At runtime, `current` resolves to enrollment trigger's channel snapshot; explicit `whatsapp|telegram` targets override. Mismatch `will never trigger` — `VERIFIED` warning, not hard error.

---

## 3. Complete Node Taxonomy

This section is the **verified taxonomy as of 2026-03-19/2026-08-12**. Deeper cards live in §§5–12.

| # | Top-level Block (as labeled in instrument bar) | Kind | Container? | Branches | Waits? | Can be first? | Can have multiple incoming? | Can have multiple outgoing? | Channel-restricted? | Plan gate | Runtime primitive |
|---|-----------------------------------------------|------|------------|----------|--------|---------------|------------------------------|------------------------------|----------------------|-----------|-------------------|
| 1 | **Starting Step / Trigger** | Envelope | Contains triggers | 0 (points to first block) | No | Yes (only first) | No (entry) | No (1 entry pointer) | Yes (trigger picker is channel-filtered) | All | Enrollment gate |
| 2 | **Message** | Container | Contains 1..N Content Blocks | 0 or N (if buttons/rows present, each button = branch) | Conditional (if last content block has buttons / quick replies / Data Collection with reply types expecting input → suspend; else auto-advance) | Yes | Yes (merging allowed, `INFERRED`) | Yes if buttons present | Yes (content block allowlist per channel) | All; WhatsApp channel needs Pro in new pricing (see §21) | Send + optionally suspend |
| 3 | **Action** | Container | Contains 1..N Action tasks (Add Tag, Set Field, Delete Contact, Set Opt-in/out, Set Bot Field, Subscribe/Unsubscribe Sequence, External Request, Change Menu, Log Conversion, Assign/Notify, CAPI, + integrations) | No (single `next`) | No | Yes (first block "could be ... action" per `14281166306332`) | Yes | No (single continue) | Some tasks channel-specific (Change Menu = Messenger-only) | Some actions Free-gated (Rules note: actions available on Free only on paid in Rules tab) | Mutate contact/bot fields + sequences + external calls (sequential, non-branching) |
| 4 | **Condition** | Logic | Single predicate group with `Does contact match: all / any` | 2 (matching vs not matching) | No | Yes | Yes | 2 | No | All | Instant evaluate against Tags / Opt-in widget/ad/API / List / Sequence / Current time (account TZ) / Segments / System+Custom User+Custom Bot Fields (date offsets allowed) |
| 5 | **Randomizer** | Logic | 2–6 variations (now up to 12 per 2026-04-07 update) with % sliders | 2–12 | No | Yes | Yes | 2–12 | No | All | Immediate random or sticky lookup; batch distribution quirk when unchecked (see §9) |
| 6 | **Smart Delay** | Timing | Single config: Duration *or* Date | 1 (`Choose Next Step`) | Yes (timer + optional continue-time window) | Yes | Yes | 1 | No but deliverability workaround channel-specific | All | Suspending; uses contact TZ else account TZ; admin pause adds to timer (`VERIFIED`) |
| 7 | **Start Automation (Start Another Flow)** | Control | Single reference: `Click to Select Automation → Pick This Automation` | 1 (after callee returns) + implicit call edge to callee | Conditional (callee runs synchronously through its messages but **skips input-waiting** for buttons/quick replies) | Yes | Yes | 1 + call | No | All | Synchronous call then resume at next step in caller (`VERIFIED` note: will send all messages before returning, will not pause to wait for button/quick reply) |
| 8 | **AI Step** | Intelligence | Goal + Context (≤10k chars) + auto-generated Tasks + custom Tasks + channel selector | Implicit? Conversation loop inside AI Step; completion advances to next block; failure → fallback/handoff `UNCERTAIN` | Yes (conversational loop) | `OBSERVED` (normally not first? docs say create trigger so people can reach it — suggests can be first but needs trigger envelope) | Yes | 1 (completion) | Yes (supports Messenger/Instagram/WhatsApp/TikTok/Telegram per `14281187288860`) | **Pro + $29 AI add-on** (`VERIFIED` `25800228332572`, `manychat.com/product/ai`) | AI-managed turn-taking, context-aware, tasks drive save-to-field + branching (`VERIFIED` structure: goal, context, tasks, Save reply to System/Custom Field) |
| 9 | **Data Collection** (content block *inside* Message, but also conceptual pause point) | Input | Lives inside Message node as a Content Block; also referenced in Sequences troubleshooting | 1 or N (Multiple choice options each become branches `OBSERVED`) | Yes (up to 30 min `VERIFIED` from sequence troubleshooting: "automation will pause in a Data Collection block and wait for ... up to 30 minutes") | No (needs parent Message) | Via parent | 1 or N | Text-based; available per Table in §6 | All | Pause awaiting reply; validation (email/phone/multiple choice) enforced where configured |
| 10 | **Dynamic Block** (content block inside Message) | Integration | Lives inside Message | Fallback optional (`fallback step` on error; without fallback silent but logged in Settings→Logs) | No (unless remote response contains wait) | No (inside Message) | Via parent | 1 + optional fallback | No | All | HTTP POST/GET/PUT/DELETE to HTTPS URL with headers/body; response must match `v2` format per `manychat.github.io/dynamic_block_docs` (`VERIFIED` `14281268533788` + `14281285374364`) |
| 11 | **Card / Gallery** (content blocks inside Message) | Media+Interactive | Inside Message; Card = 1 image+title+subtitle+optional buttons; Gallery = up to 10 cards each with optional buttons | Via card buttons | Same as Message (buttons suspend) | No | Via parent | Via buttons | Messenger/Instagram/Telegram per table (WA/TG galleries not supported) | All | Render as cards/gallery carousel |
| 12 | **Messenger List** (content block inside Message) | Subscription | Inside Message; collect opt-ins to a List (`14281158573852`) | Via opt-in? `NOT DOCUMENTED` for exact branching | `UNCERTAIN` | No | Via parent | `UNCERTAIN` | Messenger-only | `INFERRED` Pro? | Opt-in persistence |

> **Architectural callout:** Manychat's hierarchy is **Automation → Message (container → Content Blocks)**. Convox's `docs/specs/node-system.md:59` maps Communication nodes as *flat* graph nodes (`send_message`, `send_buttons`, `send_list`, `send_media`) rather than container+blocks. Both are valid serializations; Convox's flat nodes are actually **content-block specializations flattened into top-level graph nodes** (text+buttons vs list vs media). Manychat's container would be represented in Convox as **one graph node that can hold multiple content payloads** — not yet modeled.

---

## 4. Message Node (Container)

Not a "text node". Collective evidence `14281196200604` + `36000105060-flow-builder`:

- **Purpose:** Deliver channel-optimized payload(s). Central to every automation (share across all channels connected).
- **When can be used:** Always; can be the first real block after Starting Step (`VERIFIED` "Select the first block ... could be a message, action, or condition").
- **When cannot be used:** Must match channel of selected message node type (Manychat surfaces *Messenger message* vs *Instagram message* as prior to content — `VERIFIED` "choose the message block that corresponds to the channel").
- **Inputs:** 1 edge from predecessor.
- **Outputs:** `1` sequential if no interactive element; `N` button/row branches if contains Buttons/Card/Gallery rows (each button's `next` is an outgoing edge); `OBSERVED` in `14281166306332` ("Each Actions step can include multiple tasks" nearby button discussion: "click button → Remove" hints single inline, but button `next_node_key` is edge).
- **Branches:** Conditional (presence of buttons/interactive content makes branches).
- **Waits / pauses:** `Yes` if ends with buttons/quick replies/Data Collection — flow suspends awaiting reply; else `No` (auto-advance). Delay content block inside does **not** count as pause beyond typing indicator.
- **Can be first step:** Yes.
- **Can appear multiple times:** Yes (expected to be most frequent node).
- **Can point to another automation:** Not directly; that's `Start Automation` block. But buttons can have "Start another Automation" as button type (`VERIFIED` `14281157003292` button types list includes Perform Actions, Smart Delay, Start another Automation, Select Existing Step).
- **Can be targeted by buttons:** Yes (any predecessor button's `next` points to a Message).
- **Multiple outgoing:** Yes when buttoned (one per button/row).
- **Multiple incoming:** Yes (branch merging allowed — `INFERRED`; no doc forbids it).
- **Channel restrictions:** Channel determines which content blocks available inside it (see §6 table). Builder hides unavailable.
- **Plan restrictions:** Content blocks available per channel not plan-gated, but WhatsApp channel itself needs Pro post-2026-03-02 pricing (`VERIFIED` `25800228332572`: Pro allows 3 channels including WhatsApp). Free plan limited to 3 custom keyword triggers.
- **Runtime:** Sends as native channel payload. Multiple content blocks inside one Message node send sequentially as one logical payload where channel allows (`OBSERVED` `14281196200604`: "You can add multiple blocks, either different or identical, within a single message node").
- **Analytics:** Per-message delivery (implied in Automation view per-step stats).

### Message Node vs Content Block hierarchy (critical for Convox mapping)

```
Manychat Message (canvas node)
 ├── Content Block: Text (may carry Buttons)
 ├── Content Block: Image
 ├── Content Block: Delay (typing pause + indicator toggle per channel)
 ├── Content Block: Data Collection →→ suspends (30 min timeout)
 ├── Content Block: File / Audio / Video / PDF / Card / Gallery / Messenger List / Dynamic
 └── (all blocks inside one node share one incoming edge; outgoing edges fan from this container)
```

Convox today flattens this: each content block type is a distinct graph node type (`send_message` vs `send_buttons` vs `send_list` vs `send_media`) at `src/lib/flows/types.ts:30`. A Convox `send_buttons` node's `buttons[]` array is what in Manychat would be **Text content block + Buttons inside one Message node**. The underlying execution is equivalent, but authoring parity requires adding the **container** so one node can hold e.g., Text + Image + Buttons together (today Convox would need three sequential nodes).

---

## 5. Triggers / Starting Step

### 5.1 Envelope semantics

- **Location:** Rounded pill at graph top (`14281166306332` "Go to the Starting Step in the Flow Builder, click + New Trigger").
- **Capacity:** One or multiple triggers per automation (Rules tab explicitly documents multiple triggers per rule OR — `VERIFIED` `14281170185628` "You can add several triggers in one rule. For example, you can perform an action as soon as any of these tags are applied"). In-builder Automation tab says "Click + New Trigger" repeatedly — `INFERRED` multiple triggers OR in Flow Builder too, but we mark `INFERRED` for exact multi-trigger AND/OR in Flow Builder vs Rules (Rules OR is `VERIFIED`, Flow Builder multi-trigger is less explicitly documented).
- **Channel filter:** Required at trigger level; `Selecting a trigger that doesn't match automation's channel — e.g., Facebook trigger for Instagram automation — it will never trigger` — `VERIFIED` warning. Builder warns but does **not** prevent save (`OBSERVED` in `manychat-model.md:68`).
- **Trigger-specific first-node restriction:** Some triggers require first real node to be a specific channel Message before publish (e.g., Instagram Comments Reply requires at least one Instagram message node + `Send as a Private Reply` marked — `VERIFIED` `14281316989724` "you need to send a private message... to publish"). Facebook Comments similar (`VERIFIED`).
- **Plan:** Keywords Free limited to 3 custom triggers (`VERIFIED` `14281211785884`: "Free accounts are limited to 3 custom keyword triggers").
- **Runtime:** Enrollment gate only; not run state. `last_executed_at` bump via RPC.

### 5.2 Trigger catalog (verified list)

Actual picker in Flow Builder's `+ New Trigger > Events` plus Keywords/overlay sources.

| Trigger (Starting Step option) | Event | Channels | Configuration fields | Filters/Exclusions | Entry behavior | Re-entry | Notes |
|-------------------------------|-------|----------|----------------------|--------------------|----------------|----------|-------|
| **User sends a message (Keywords)** | Inbound text / `reply_title` / `reply_id` (deduped per `src/lib/flows/engine.ts:134`) | Instagram, Messenger, WhatsApp, Telegram, SMS (`VERIFIED` `14281211785884`: "works seamlessly across supported channels ...") | keywords[≤10], rules, channel picker, intention description (AI) or explicit keywords, priority order (list order = priority, first matching fires) | Rules: `Message is` (exact, case-insensitive, any extra word/symbol blocks), `Message contains` (substring), `Message contains like` (word-boundary - distinguishes hi/within), `Message begins with`, `Message is Thumbs Up` (Messenger-only), `Message doesn't contain` (exclusion), `+Message condition` (compound). Max 10 keywords/rule. | Enrollment per matching inbound; consults keyword priority list before match | Per message; one trigger hit per inbound if keyword ordering picks it | Intention-based alternative: describe intent, AI matches (`VERIFIED`). Also lives at `Automation > Keywords` as global + in-builder alias |
| **Instagram Post & Reel Comments** | Comment under post/reel containing (or excluding) keyword | Instagram | scope: Specific post/reel | Any post/reels | Next post/reel; keyword include/exclude list; random public reply variations | Any comment / include-list / exclude-list | Per-comment auto-reply + DM (requires Instagram message node marked Private Reply) + 24h window caveat (window opens only on button/quick reply tap) | `VERIFIED` `14281316989724`: only first comment per user per post/reel triggers; boosted post support since 2024-06-11; collaborative posts work from owner or collaborator |
| **Facebook Comments** | Comment on FB post | Messenger | post scope (any or specific), scheduled post compatible | Similar to IG comments | Auto-reply + private Messenger response (first message marked as comment reply mandatory) | `VERIFIED` `14281386567836` |
| **Instagram Story Reply / Mention / Live interaction** | Story reply, story mention, live | Instagram | `NOT DOCUMENTED` individually but referenced in SetSmart 2026 catalog (`setsmart.io/blog/manychat-automation`: lists story reply, story mention, live-stream interaction) | `UNCERTAIN` field-level specifics | As above | `OBSERVED` (SetSmart AI summary; cross-check Help Center if possible) |
| **Click-to-Messenger / Click-to-WhatsApp Ad click** | User clicks ad CTA | Messenger / WhatsApp | Ad selector | Channel-picked ad | Direct enrollment | Per click | Listed in SetSmart: "click on a Click-to-Messenger / Click-to-WhatsApp ad" — `OBSERVED`; community confirms |
| **New / First inbound message** | Contact's first inbound (isFirstInboundMessage flag in Convox analog) | Per-channel | Optional channel filter | `VERIFIED` `manychat-model.md:44` origin but Help Center not individually crawled this pass — mark `INFERRED` until doc ID pinned |
| **QR code scan** | QR scan on Messenger/IG | Messenger/IG range | `NOT DOCUMENTED` this pass | — | — | `UNCERTAIN` (mentioned in Flow Builder generic trigger description "scans a QR code" `14281166306332`) |
| **Button / Quick Reply tap** | Interactive reply inside an existing flow | Per-channel | `reply_id` match | — | Requires no window rebuild — routes via existing run's `reply_id` match, not new enrollment, unless `interactive_reply` dedicated trigger used for cross-automation chaining | Per tap | Distinguish: inside-flow button suspend/resume vs global `interactive_reply` trigger across automations |
| **System Triggers (Rules tab only, not in-builder Starting Step — global scope):** Date/Time, Log conversion event (Manychat Pixel), Tag applied/removed, Subscribed/Unsubscribed to Sequence, Custom field value changed, System field value changed, New contact (`VERIFIED` `14281170185628` Rules trigger list) | Global `if tag then action` outside flows | Account-wide | See Rules §3.7 | Conditions gate execution | `VERIFIED`: multiple triggers per rule OR; multiple actions per rule |
| **Growth Tools legacy** | Growth Tools tab discontinued | — | — | `VERIFIED` `14281111044124`: "Growth Tools tab that used to be on the left is now missing ... all can be viewed, created, and edited through Automation tab" |

> **Unknown vs Convox:** Convox catalog (`docs/specs/node-system.md:39`, `src/types/index.ts:482`) lists richer CRM/business triggers (`contact_changed`, `note_added`, `task_added`, `customer_replied`, `opportunity_created`, `pipeline_stage_changed`, `inbound_webhook`) that Manychat covers via **Rules** global tag/field/sequence triggers rather than in-builder Starting Step. Gap is architectural, not channel.

### 5.3 Multiple triggers & trigger combinations

- **FLows:** In-builder `+ New Trigger` can be clicked repeatedly → multiple triggers stacked on same Starting Step. Composition is **OR** (`INFERRED` from Rules analog; no Manychat doc says AND for Flow triggers — opening multiple keyword/comment/ad triggers to fire into the same graph would be OR). We mark OR until a doc proves otherwise, but keyword priority list suggests single trigger matching still respects list order.
- **Rules:** `VERIFIED` multiple triggers per rule OR (`14281170185628` "You can add several triggers in one rule ... as soon as any of these tags are applied").

### 5.4 Trigger execution guarantees

- Channel mismatch → `will never trigger` warning, not hard error (`VERIFIED`).
- Duplicate subscriptions: not guarded explicitly; keyword priority ensures only top keyword wins per inbound. If multiple automations listen to same keyword, order? `INFERRED` creation order (oldest wins when no keyword — `VERIFIED` for IG Comments Reply tie-breaker: "oldest trigger ... will always run" `14281316989724`; assume similar for keyword collisions, but `UNCERTAIN`).

---

## 6. Message Content Blocks (Complete Current List — VERIFIED 2026-03-19)

Channel matrix per `14281196200604` (updated 2026-03-19). This is the **authoritative allowlist**:

| Content Block | Instagram | Messenger | TikTok | Telegram | SMS | Purpose / Config | Limits / Requirements |
|---------------|-----------|-----------|--------|----------|-----|------------------|------------------------|
| **Text** | ✓ | ✓ | ✓ | ✓ | ✓ | `text` string; optional buttons; `{{custom field}}` interpolation in text and button titles (`OBSERVED` CUF as variable: `{{user fields}}`, section 5.2). | Buttons ≤3 on IG/Messenger/WhatsApp Text; ≤10 on Telegram Text (`VERIFIED` `14281157003292` + node data). Max length `INTERACTIVE_LIMITS.bodyMaxLength` at Convox (cap ~1024). |
| **Image** | ✓ | ✓ | ✓ | ✓ | ✓ | `file` or `URL` (`image_url`); formats JPEG/PNG/GIF (Messenger 25MB videos, JPG/PNG/GIF images); WhatsApp/IG `5MB` image; `VERIFIED` per `14281196200604` SMS row `Text, Image, Data collection` | Min 500×262, rec 900×900 — `14281167455388` |
| **Delay** (typing pause **inside** message — NOT Smart Delay) | ✓ | ✓ | ✓ | ✓ | ✗ | `duration` + `showTyping indicator` toggle per channel (some channels indicator optional) `VERIFIED` per `14281196200604` — SMS row lists only Text/Image/Data collection, so SMS Delay is `VERIFIED` absent | Does NOT suspend graph beyond pause. |
| **Data Collection** | ✓ | ✓ | ✓ | ✓ | ✓ | Reply type (free text / multiple choices / phone / email / URL / File / Image / Location) + target `Custom User Field` (type must correspond — Number vs Text nuance `VERIFIED` `183629...` "Number reply type → Number CUF; Phone → Phone System Field or Text"). Pauses up to 30 min. Multiple-choice options each become branches. If contact not responded branch optional (`VERIFIED` in preview limits). | Collects into CUFs/Bot Fields; 30-min wait; preview cannot enforce validation, cannot preview Multiple Choice/not-responded (`VERIFIED` `14281198254620`). |
| **File** | ✗ | ✓ | ✗ | ✓ | ✗ | Generic attachment; docs PDF/DOC/XLS/TXT etc 100MB max | Messenger & Telegram only |
| **Audio** | ✓ | ✓ | ✗ | ✓ | ✗ | AAC/MP4/MPEG/AMR/OGG/OPUS 16MB | IG+Messenger ✓, TG ✓, TikTok ✗ |
| **Video** | ✓ | ✓ | ✗ | ✓ | ✗ | MP4/3GP 16MB, downsample, compress | Same as Audio |
| **PDF files** | ✓ (added 2026-02-20) | ✗ | `PDF files` row lists ✓ for Instagram only; Messenger/TikTok/Telegram/SMS rows absent — `VERIFIED` per `14281196200604` IG-first. Community 2026-02-20: "You can now send PDFs in Instagram automations ... pick PDF from content blocks" `VERIFIED` | Preview in chat | IG ✓, others ✗ (`VERIFIED` absent) until Help Center expands |
| **Card** | ✓ | ✓ | ✗ | ✗ | Image + title + subtitle + optional buttons `VERIFIED` per `14281196200604` TG allowed set `Text/Image/Delay/DataColl/Audio/Video/Dynamic/File` — Card/Gallery `VERIFIED` absent on Telegram | Gallery up to 10 cards each with optional buttons (`VERIFIED`). Aspect ratio 1.91:1. |
| **Gallery** | ✓ | ✓ | ✗ | ✗ | ✗ | Up to 10 images each with optional buttons | Same |
| **Messenger List** | ✗ | ✓ | ✗ | ✗ | ✗ | Collect opt-ins to a List (`14281158573852`) | Messenger-only |
| **Dynamic** | ✓ | ✓ | ✗ | ✓ | ✗ | HTTPS Request (POST/GET/PUT/DELETE) + headers+body; response must match Manychat `v2` format (`manychat.github.io/dynamic_block_docs`). Test Request per contact; Fallback optional (with/without fallback logging `Settings→Logs`) | Limits: ≤10 messages, 11 Quick Replies, 5 Actions in `messages` block (`VERIFIED` docs on `dynamic_block_docs` GitHub). 75s video timeout, 10s other |

For each block, the Convox-relevant fields are:

```
Text { text: string, buttons?: Button[], interpolation: "{{field}}" }
Image { url: string, caption?: string }
Delay { durationMs: number, showTyping?: boolean }
DataCollection { prompt_text, reply_type, target_field: CustomUserFieldId, var_key, validation, multiple_choices?: {label, next}[], timeout: 30min, notRespondedBranch? }
File/Audio/Video/PDF { url, filename?, caption? }
Card { image_url, title, subtitle, buttons[] }
Gallery { elements: [{ image_url, title, subtitle, buttons[], action_url? }], image_aspect_ratio: horizontal|square }
MessengerList { listId }
Dynamic { request_type: POST|GET|PUT|DELETE, url: HTTPS, headers?, body?, fallback_next?, response_format: v2 }
```

**Max counts (VERIFIED where doc states; otherwise via Convox limits co-authored from Meta docs):**

- Buttons per Text block: IG/Messenger/WhatsApp ≤3; Telegram ≤10
- Gallery: ≤10 cards
- Messages per `messages` block in Dynamic response: ≤10
- Actions per Dynamic response: ≤5
- Quick Replies per Dynamic response: ≤11
- Image max 5–8 MB (Messenger 8MB images, 25MB other; WhatsApp 5MB image; docs 100MB file)
- Caption ≤1024 (Convox `INTERACTIVE_LIMITS.bodyMaxLength`)
- Button title ≤20, List row title ≤24, description ≤72 (`src/lib/whatsapp/interactive.ts` + `14281167455388` validators)

---

## 7. Action Node (Container, Multi-Task)

### 7.1 Model

`VERIFIED` "Each Actions step can include multiple tasks" (`36000105060-flow-builder`) + `17636378650268` category pages.

```
Action Node (single canvas block, single incoming, single next)
├── Task 1: Add / Remove Tag
├── Task 2: Set / Clear User Field
├── Task 3: Subscribe / Unsubscribe Sequence
├── Task 4: External Request / Dynamic (HTTP)
├── ... (up to N tasks, sequential)
└── → next node
```

- **Multiple actions per node:** Yes, authored as task list inside the editor (click `+ Action` then pick from category list). Execution order = list order (`INFERRED` — no doc says parallel; Convox runs sequential `runStep` per position).
- **Branching:** No branching inside Action. Single `next`.
- **Failures:** Per-task error scopes? `INFERRED` warning not fatal — Convox's `set_tag` path logs `set_tag_failed` warning and continues (`src/lib/flows/engine.ts:904`), matching Manychat's silently logged `Settings→Logs` behavior for Dynamic without fallback. Mark `INFERRED` until Manychat failure policy pinned.
- **Retry:** `NOT DOCUMENTED` as user-configurable retry.
- **Reusability:** Same Action categories appear in **Rules** tab as global actions (`VERIFIED`).

### 7.2 Every current action type (verified from `17636378650268` + integrations)

| Category | Action | Config fields | Required | Optional | Notes |
|----------|--------|---------------|----------|----------|-------|
| **Recently used** | (virtual) | list of last-used tasks | — | — | UX shortcut, not runtime |
| **Contact data** | **Add / Remove Tag** | `tag_id` (pick from existing Tags; Tag = `{name,color}` at `src/types/index.ts:122`) | `tag_id` | — | Segmentation; runtime `contact_tags` insert/delete scoped by account |
| | **Set / Clear User Field** | `field_id` + `value` (interpolated `{{user field}}` allowed); Clear variant needs only `field_id` | `field_id` | `value` for Set | CUF type must match Data Collection reply type (see §6); Bot Fields are global vs User Fields per-contact (`VERIFIED` CUF docs) |
| | **Delete Contact** | (none) | — | — | Permanent delete |
| | **Set Channel Opt-in / Opt-out** | `channel` (dependent on connected channels) + `opt` | `channel` | — | Manages subscription status per channel |
| **Automation** | **Set Bot Field** | `bot_field_id` + `value` | `field_id` | `value` | Global across all users |
| | **Subscribe / Unsubscribe to Sequence** | `sequence_id` | `sequence_id` | — | Enrollment visible in Sequence stats (stuck/not-subscribed/timing/duplicate) |
| | **Make External Request** | `request_type POST|GET|PUT|DELETE` + `HTTPS URL` + `headers` + `body` | `url` HTTPS | `headers`, `body` | For advanced integration beyond native; distinct from Dynamic content block but similar config. Test Request per contact. Without fallback, error silent but logged (`Settings→Logs`) (`VERIFIED` `14281285374364`). |
| | **Change Menu in Messenger** | `menu_id` | `menu_id` | — | Messenger-only |
| | **Log Conversion Event** | `event_name` + optional `value` | `event_name` | `value` | For pixel/Manychat Analytics revenue attribution (`VERIFIED` `manychat.com/blog/product-update-manychat-analytics` custom Action Step Conversion with revenue value) |
| **Inbox** | **Mark conversation as Open / Closed** | `status: open|closed` | `status` | — | Inbox management |
| | **Assign conversation** | `mode: specific|round_robin` + `agent/group` | `mode` | `agent_id` when specific | Ensures timely responses |
| | **Notify Assignees** | `channel: email|sms` + `message` | `channel` | — | Notify Admins via Messenger temporarily unavailable per FB policy (`VERIFIED`) |
| **Ads Optimization** | **Send event to Meta Conversions API (CAPI)** | `event`, `value`, `currency`, etc. | `event` | per API | Meta Ads ROI optimization (`VERIFIED` `14580897414300`) |
| **Integrations** | Any connected integration's actions (Zapier, Google Sheets, etc.) | integration-specific | per integration | — | Appear under same panel (`VERIFIED`) |

**Nested semantics:** Action Editor field-by-field (`src/components/flows/forms/node-config-form.tsx:1` `NodeConfigForm` already models channelTarget rows + config lists). To match Manychat, Convox editor must: `Header: Action` → `Max tasks list (drag to reorder)` → `+ Action → Category picker → Task config form (fields per action)` → per-task validation badge → save. Execution: `runStep` sequential in account-scoped order (`src/lib/automations/engine.ts:510`).

---

## 8. Condition Node

### 8.1 Core

`VERIFIED` `14281142518556` (updated 2026-08-12). Visual: diamond, then split.

- **Condition groups:** Yes — "combine multiple conditions within a single block, allowing contacts to proceed if they meet either all or any" (`VERIFIED` screenshot `Does the contact match: all / any`). Corresponds in Convox to recent `conditions[] + match all|any` addition (`src/types/index.ts:702`, `src/lib/flows/types.ts:173`, both `P1`).
- **AND / OR logic:** `all` = AND, `any` = OR inside one Condition block.
- **Nested conditions:** Not explicit as nested diamonds inside one block; nesting is achieved by branching → another Condition node down one leg (`INFERRED`).
- **Outputs:** 2 (`matching path` + `non-matching path` in Help Center naming; Convox uses `true_next/false_next` or `yes/no`). Both must have a target for deterministic flow (sequence troubleshooting: "If there is no follow-up after a condition, that message won't be fully sent" — `VERIFIED` `14281202572316`).
- **Wait:** No suspend; immediate evaluation.
- **Evaluation in preview:** In `In Manychat` preview conditions cannot be evaluated automatically — user manually chooses path (`VERIFIED` `14281198254620`: "Randomizer and Condition steps are only visible to you ... you must manually choose a path").
- **Operators / comparison types:** Mirrors field types. Custom Bot Fields / Custom User Fields / System Fields conditions support `Date or Date/Time` formulas with offsets (e.g., `coupon utilization date does NOT exceed issuance date + 3 days` — `VERIFIED`). Convox current operators are narrower (`equals|contains|present|absent` for Flows, `contact_field|tag_presence|message_content|time_of_day` for Automations — unified target `src/lib/flows/types.ts:145`).

### 8.2 Available fields (verified catalog)

| Filter | Macro | Channel | Operator / Example |
|--------|-------|---------|---------------------|
| Tag | `contact has Tag X` | any | present/absent |
| Opted-in through widget | widget id | IG/FB | opted in or not |
| Opted-in through ad | Facebook Ad created in Ads tab | FB | "only works with FB Ads created in Ads tab" `VERIFIED` |
| WhatsApp CTWA workaround | Tag or User Field `ad_source = name` | WA | Unable to distinguish CTWA ad via Opted-in through widget — use Tag/User Field per `VERIFIED` `14281142518556` |
| Opted-in through API | API opt-in | any | present/absent |
| Messenger: List subscription available right now | `Messenger List` subscription available | Messenger | `VERIFIED` `14281158573852` |
| Messenger: Subscribed to List | `Subscribed to List` | Messenger | `VERIFIED` |
| Sequence subscription | subscribed to Sequence X | any | subscribed or not |
| Current time | time of day | any | Account TZ (`VERIFIED` "Current time ... displayed and exported based on selected time zone" + `14281213783068`) |
| Segments | predefined segment | any | matches segment |
| System Fields / Custom User Fields / Custom Bot Fields | any registered field | any | equals/contains/present/absent + date offsets with formulas |

**Empty/null behavior:** `NOT DOCUMENTED` as explicit semantics. Assume `present`/`absent` check null/empty as falsy; `equals ""` only matches empty. Mark `UNCERTAIN` until Help Center confirms.

### 8.3 Example real configurations

- `Does contact match ALL: Tag=lead_qualified, Custom User Field interest=buyer, System Field phone present → Matching: send WhatsApp template → Not: collect phone`.
- `Does contact match ANY: Opted-in through widget X, Segment premium → Matching: randomizer 50/50 → Not: wait 1 day`.

---

## 9. Randomizer

`VERIFIED` `14281151100060` + `36000080590-randomizer` + community update 2026-04-07.

| Field | Contract |
|-------|----------|
| **Purpose** | A/B split: test message variations, contests, tournament routing, personalized experiences |
| **Model** | `RandomizerNodeConfig { variations: [{key,label,percent,next_node_key}] (2–6, now up to 12 per community update), mode: sticky|every_time (unchecked = sticky default) }` — channel-neutral |
| **Number of variants** | 2–6 originally (`VERIFIED` "You can create up to six variations" `14281166306332`); community product update 2026-04-07 claims **12** now (`OBSERVED` `9481` — needs official Help Center update; carry as `VERIFIED (new) + OBSERVED until Help Center updated`) |
| **Percentage configuration** | Sliders per variation; user drags to set `percent` → sum must = 100 (balance validated via slider UX; engine expects sum=100) |
| **Defaults** | 2 variations 50/50; `Random path every time` unchecked (sticky) default (`VERIFIED`) |
| **Validation** | ≥2 variations, sum 100 (`INFERRED` from slider; stricter docs not stating error text). Convox enforces `validateStepsForActivation:142` / `validateFlowForActivation:864` 2–6, sum 100. Update to 2–12. |
| **Output model** | 2–12 branched outputs each with percentage label on edge |
| **Runtime selection — sticky (unchecked)** | First visit assigns contact to group A/B/C persistently; subsequent entries follow same path for that contact (`VERIFIED`: "once contacts reach Randomizer block with the 'Random path every time' checkbox unticked, they are sorted into ... Since then, it won't be possible to change group"). Distribution batches: e.g., 1000 contacts → 200 A, 200 B, 200 C, then 200 A, 200 B → A/B 400, C 200 (docs call this batch balancing quirk). |
| **Runtime selection — random (checked)** | Random every visit, no stats reference, natural distribution (`VERIFIED`): use for one-time broadcasts to avoid skew |
| **Deterministic vs random** | Sticky is deterministic per contact; checked is true random (not sticky) |
| **Persistence** | Per-contact bucket stored (implied). Convox must persist `randomizer sticky bucket per (flow_id, node_key, contact_id)` — not yet defined. Gap P1 |
| **Analytics** | Distribution per variation; not separateTyped metrics beyond distribution (`INFERRED`) |
| **Editing** | Click + New Variation or drag sliders; deleting variation redistributes percentages (`INFERRED`) |
| **What can connect before/after** | Before: any node; After: each variation's `next_node_key` points to any node; merging downstream allowed (`INFERRED`) |

**Recommendations (VERIFIED):**
- Ongoing automations (quizzes/sales/tournaments) → unchecked (sticky) to gradually even out.
- One-time broadcasts → checked (random every time) to honor law-of-large-numbers natural distribution.

---

## 10. Smart Delay

### 10.1 Two types (VERIFIED `14281197046812`)

```
Smart Delay
├── Duration
│   ├── Delay duration: amount (minutes / hours / days) — max 365 days (old support article 36000068629)
│   ├── Set continue time limit □ → Continue between HH:mm – HH:mm (must pass left < right, validation error if left ≥ right)
│   ├── Day filter: Any Day | specific days (weekday multi-select)
│   └── Choose Next Step (single)
└── Date
    ├── Specific Date: exact datetime
    └── Dynamic Date: date from Custom User Field ± Offset (minutes/hours/days, before/after)
```

### 10.2 All details

| Concern | Contract | Source |
|---------|----------|--------|
| Duration unit | minutes / hours / days | `VERIFIED` `14281197046812` |
| Continue-time windows | Optional `Set continue time limit` checkbox → `Continue between 08:00–22:00` + day filter | `VERIFIED` screenshot `17623284492060` |
| Timezone | Contact's TZ, else account TZ | `VERIFIED` Important note |
| Admin pause | If automation paused due to admin action (e.g., sending message), pause duration added to Smart Delay timer | `VERIFIED` Important note |
| Waiting state | Visible: Overall (entered), Waiting (currently delaying), Passed (completed → next) with Total + Unique on click | `VERIFIED` Smart Delay statistics |
| Resume | Scheduled execution jumps to `Choose Next Step` target; if window specified, contact proceeds only during that window; what happens if scheduled time falls **outside** window → queued until window opens (`INFERRED` from example community Q: "if person enters before 22:00 to 20:59 tomorrow, it will send exactly at 21:00 tomorrow" — suggests window queuing) |
| What if time falls outside window | Queued to next window occurrence (next day 08:00 etc.). 1-min delay with 20:00–21:00 window scenario: entering at 20:48 → sent at 20:49; entering at 15:00 → sent at 20:00 tomorrow (`OBSERVED` community `4328`) — mark `INFERRED` until Help Center clarifies |
| Editing | Click step to see menu; adjust delay; `Choose Next Step` rewired via drag | `OBSERVED` screenshot flow |
| Cancellation | Not explicitly cancellable mid-wait beyond admin pause extension; contacts counted Waiting vs Passed | `INFERRED` |
| Connection | Single incoming; single outgoing after delay | `VERIFIED` "Click Choose Next Step to determine what will happen after" |
| Channel/runtime | Channel-neutral; but **does NOT reopen 24h window** — follow-up regular message after >24h delay won't deliver (`VERIFIED` note). Workarounds: IG/Messenger use special message block types per `14281199732892`; WA use Message Template; Telegram no limit | `VERIFIED` deliverability section |
| Publish | Validates left time < right; max 365 days; uses contact TZ else account TZ | `OBSERVED` via legacy `36000068629` (`support.manychat.com` pre-Help Center) — `VERIFIED` article `14281197046812` documents window UI but does not state publish block text; treat as `OBSERVED` not `VERIFIED` primary until current article updates |

### 10.3 Message Delay vs Smart Delay — Architecturally Different

| Dimension | Delay (content block inside Message) | Smart Delay (standalone block) |
|-----------|--------------------------------------|--------------------------------|
| Location | Inside Message node as a Content Block (`Text / Image / Delay` list) | Own canvas node with `Choose Next Step` |
| Semantics | Typing pause + optional typing indicator per channel; **does not suspend automation** beyond natural pause | Timer-based suspend; waiting state per contact; overall/waiting/passed stats |
| Channel | Per §6 Delay allowlist per channel | Neutral |
| Branching | No | Single outgoing edge after resume |
| Timeout semantics | None | Contact-specific timer + continue-time window evaluation |
| 24h window | Not special | Special deliverability caveat (`VERIFIED`) |
| Editing | Drag inside message | Click step menu + Choose Next Step |
| Preview | Visible in `In Manychat` | Not displayed/executed in `In Manychat` (`VERIFIED` Non-content elements preview limitation) |

Convox's current `WaitNodeConfig { amount/unit/until/next_node_key }` at `src/lib/flows/types.ts:190` and `WaitStepConfig` at `src/types/index.ts:683` implements **Duration-only with optional `until` (date) inside same node** — halfway to Smart Delay Date mode. Missing: `Continue-between window + day filter + contact TZ + admin-pause extension` (gap P2 — `docs/specs/node-system.md:253` "Future: expand Wait to those variants (currently fixed duration only)").

---

## 11. Start Another Automation

`VERIFIED` `14281157602716` (How to set up a Start Automation step) + community `7953` (does new automation need triggers?).

| Concern | Contract |
|---------|----------|
| **How target selected** | In caller automation canvas: `Click to Select Automation → Pick This Automation` modal listing existing automations (filterable). Requires callee exists; broken reference = warning (`UNCERTAIN` exact warning text — likely shows missing reference badge) |
| **Synchronous / async** | **Synchronous:** "An automation connected through the Start Automation step will send all the messages before returning to the initial automation. However, it will not pause to wait for the contact's input on messages with buttons or quick replies." (`VERIFIED` ⚠️ Note) |
| **Does execution return?** | Yes — after callee completes its messages, caller resumes at its next node (`Choose next after completed` wired via dot-drag) |
| **What happens with user interaction / buttons / quick replies** | Callee's buttons/quick replies are **skipped** — no wait. Callee's messages flush unconditionally then return |
| **Duplicate subscriptions** | Callee enrollment does not re-trigger its own Starting Step triggers separately — it's a direct call, not via trigger evaluation; deduped |
| **Recursion** | If A calls B and B calls A → infinite loop risk; docs advise "Folders and naming ... break down larger, more complex ones into smaller, reusable automations to make management easier using Start Automation" but no explicit recursion guard (`NOT DOCUMENTED` for loop detection across automations). Mark `UNCERTAIN` — implement guard P1 |
| **Connection model** | Single incoming; single outgoing (continue after return) + implicit call edge to callee (not drawn as geometric edge until you wire continue). Some docs show dot→drag to next step after selection |
| **Button behavior** | Button `Start another Automation` as `button type` inside Message: not to be confused with canonical Start Automation block — button-level Start Another is same semantics but triggered on tap |
| **Runtime implications** | Contact execution state moves into callee, finishes there, returns; caller stats should attribute time spent in callee to caller path? Analytics under Shared vs Callee (`INFERRED`) |
| **Error** | Callee deleted → broken edge; caller publish warns (`UNCERTAIN` exact message) |

Convox analog: `docs/specs/node-system.md:361` "Reusable Start Automation single call edge + single continue after return (target P2 — not yet graph-level, today Flows have no Start Automation, Automations use trigger chaining indirectly)". Today's `interactive_reply` trigger chaining across automations approximates it, but true sync call+return not graph-level.

---

## 12. AI Step

`VERIFIED` = `14281187288860` (Manychat AI Step) + `14281200017948` (AI Flow Builder assistant) + `14281227789468` (Power up with AI) + `creatorlanehq.com` pricing.

### 12.1 AI Step (standalone runtime primitive)

| Field | Contract | Evidence tier |
|-------|----------|---------------|
| **Purpose** | AI-managed turn-taking for complex interactions: collect info or give personalized responses on free-text | `VERIFIED` |
| **Goal** | Define what AI is intended to achieve, e.g., "Determine user's needs and how we can assist" | `VERIFIED` |
| **Context** | Up to 10k characters background: business capabilities/limits, products/services, FAQs, tone, language | `VERIFIED` + `manychat.com/product/ai` "You've got 10k characters ..." |
| **Tasks** | AI auto-generates tasks after goal+context provided; user can edit each task by clicking, or add custom tasks via `New Task`; each task optionally `Save reply` → pick System or Custom Field | `VERIFIED` screenshot `181...` in AI Step doc |
| **Custom tasks** | `New Task` button adds custom task (label + save target) | `VERIFIED` |
| **User input** | Conversation loop: AI asks, contact replies in free-text, AI interprets, moves to next task or completion | `INFERRED` from goal/context/tasks model |
| **Channel support** | Messenger, Instagram, WhatsApp, TikTok, Telegram (`VERIFIED` note: "AI Step currently supports FB Messenger, Instagram, WhatsApp, TikTok, and Telegram") + if not first step, channel auto-set to previous node's channel (`VERIFIED`) | `VERIFIED` |
| **Fields** | Save to `System Field` or `Custom Field` (tick `save the user's reply`) | `VERIFIED` |
| **Output behavior** | Completion → advance to next block (implicit single outgoing). Intermediate AI messages are visible as chat bubbles | `INFERRED` (not explicit in docs) |
| **Failure / fallback** | `NOT DOCUMENTED` per se; AI Replies tab docs suggest `Settings→Logs` covers Dynamic errors; for AI Step, assume handoff/fallback branch `UNCERTAIN` | `UNCERTAIN` — needs live account verify |
| **Handoff** | AI system (global) does AI Replies/Comments when nothing else handles message, then Default Reply if no scenario (`VERIFIED` `14281227789468` "system first checks if any other automation can handle it ... passed to AI ... Default reply if not") — AI Step handoff inside flow `NOT DOCUMENTED` | `UNCERTAIN` |
| **Testing** | AI Step editor has `Save & Start Chat` / `Restart` chat simulator (`VERIFIED` screenshot flow) | `VERIFIED` |
| **Preview** | Chat simulation only, not classic `In Manychat` widget (`INFERRED`) | `INFERRED` |
| **Runtime semantics** | Conversational primitive: holds run in AI Step until goal satisfied or tasks complete or handoff; channel-neutral scheduling; contact TZ for window? `NOT DOCUMENTED` | `NOT DOCUMENTED` |
| **Analytics** | `NOT DOCUMENTED` | `NOT DOCUMENTED` |
| **Limitations** | Requires Pro + $29 AI add-on; 10k context limit; channel auto-inherit when not first | `VERIFIED` |
| **Config UI** | Step 1 Generate (goal, context → Generate) → Step 2 Configure (channel picker, task list, save-to-field checkboxes, Save & Start Chat) → Step 3 Going Live (trigger + Set Live) | `VERIFIED` |

### 12.2 AI Flow Builder Assistant (generator, not a graph node)

- Bottom chat window in Flow Builder (`VERIFIED` `14281200017948`): 8 steps: business description → goals (leads/engagement/appointments) → channel (IG/Messenger/WhatsApp/Telegram) → template/intention → trigger → generate ≤30s → `Use Automation` or `Back To Chat` / `Start from Scratch`. Best practices: clear description, specific goals, review/customize, test before publishing, iterate.
- Also: **Intention-based keyword** ("recognize intention" — describe intent, AI matches message) under Keywords trigger list (`VERIFIED` `14281211785884`).

### 12.3 Convox implication

AI Step is **its own runtime primitive**, not "an AI message". Convox has no AI graph node; AI lives as `ai_knowledge_chunks` / `ai_knowledge_documents` for knowledge + `ai/config` per-account config and `ai/knowledge` matchers (`src/lib/ai/knowledge.ts:1` community 69) + Dispatch `auto-reply` fallback decision `fallback.ts:1`. Parity would need `ai_step` node type with goal/context/tasks persisted and runtime delegated to LLM loop + fieldWriter — P3/P4.

---

## 13. Connection / Graph Rules

### 13.1 Compatibility matrix (derived from Help Center + `manychat-model.md:6` implications)

Let **allowed-before** = predecessor edge kinds the block can accept; **allowed-after** = outgoing kinds it produces.

| Block → can connect to → | Trigger | Message | Action | Condition | Randomizer | Smart Delay | Start Auto | AI Step | Data Collection (content) | Dynamic (content) |
|----------------------------|---------|---------|--------|-----------|------------|-------------|------------|---------|---------------------------|--------------------|
| **Trigger (Starting Step)** | — | ✓ (`VERIFIED` "Select the first block ... could be a message, action, or condition" for Message/Action/Condition) | ✓ (`VERIFIED` same quote covers Action/Condition) | ✓ (`VERIFIED` same) | ✓ `INFERRED` (Randomizer as first — no doc explicitly lists it first but no restriction documented) | ✓ `INFERRED` | ✓ `INFERRED` | ✓ `INFERRED` (AI Step can be first with trigger) | — (inside Message only) | — |
| **Message** | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (INFERRED) | implicitly (add block inside Message) | implicitly |
| **Action** | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `UNCERTAIN` | — | — |
| **Condition** | ✗ | ✓ (each branch) | ✓ | ✓ | ✓ | ✓ | ✓ | `UNCERTAIN` | — | — |
| **Randomizer** | ✗ | ✓ (per variation) | ✓ | ✓ | ✓ (observed via stacking multiple randomizers is allowed; 12-path update suggests stacking no longer needed) | ✓ | ✓ | `UNCERTAIN` | — | — |
| **Smart Delay** | ✗ | ✓ (`Choose Next Step`) | ✓ | ✓ | ✓ | ✓ (`INFERRED` — can chain delays) | ✓ | `UNCERTAIN` | — | — |
| **Start Automation** | ✗ | ✓ (`next` after return) | ✓ | ✓ | ✓ | ✓ | ✓ (recursive, `UNCERTAIN` guard) | `UNCERTAIN` | — | — |
| **AI Step** | ✗ | ✓ (completion edge) | `UNCERTAIN` | `UNCERTAIN` | `UNCERTAIN` | `UNCERTAIN` | `UNCERTAIN` | `INFERRED` chaining | — | — |

> **Strictly forbidden:** `Anything → Trigger` (Trigger is entry envelope, not target). `Anything → DataCollection/Dynamic` outside Message (content blocks must live inside Message). **No restriction documented** on `Message → Message` self-loop verbatim, but auto-publish guard + 30-block pause suggests loop must contain a pause.

If you treat Message's content blocks as **inner blocks** (not graph edges), then `Message → Message` edge is the graph-level connection; inner blocks do not create `Message → Delay` geometric edges.

### 13.2 Edge cardinalities

| Edge kind | Notation | Count per predecessor | Count per target | Example |
|-----------|----------|-----------------------|------------------|---------|
| Sequential `next` | `→` | 1 per non-branching node | Many (merge ok) | Action → Condition |
| Condition branches | `matching` / `not` | Exactly 2 well-formed (both wired is recommended; docs: missing follow-up = "message won't be fully sent") | Each branch points to one node | Condition → [A, B] |
| Randomizer branches | `variation[i].next` | 2–12 | Each points to one | Randomizer → [M1, M2, M3...] |
| Button branches | `button[i].next_node_key` | 1 per button/row | Each points to one | Message(Text+3 Buttons) → [A,B,C] |
| List row branches | `row[i].next_node_key` | 1 per row | Each points to one | Message(List+rows) → [R1..R10] |
| Smart Delay next | `Choose Next Step` | 1 | 1 | Delay → Next |
| Start Auto continue | `next after return` | 1 | 1 | StartAuto → Next (+ implicit call to callee) |
| AI Step completion | `→ next` | 1 | 1 | AI → Next |
| Data Collection branches | `multiple choice next`? `NOT DOCUMENTED` branch fan-out | 1 or N | Each points to one | Message(DataCollection multiple_choice) → [O1,O2...] |

Convox analogues verified in `src/lib/flows/validate.ts:978` `outgoingEdges` switch: `send_buttons` → `buttons[].next_node_key`, `send_list` → `sections[].rows[].next_node_key`, `condition` → `true_next/false_next`, `randomizer` → `variants[].next_node_key`, etc.; single `next_node_key` for others. Merge check: `reachableFromEntry` BFS at `src/lib/flows/validate.ts:956` does not forbid merge — `visited` set allows it.

### 13.3 Topology rules (official vs implementation)

| Rule | Manychat behavior | Evidence | Convox today (`src/lib/flows/validate.ts:1`, `src/lib/automations/validate.ts:1`) | Gap |
|------|-------------------|----------|------------------------------------------------|-----|
| **One-to-one** | Yes (most sequential edges) | `VERIFIED` | Yes | — |
| **One-to-many** | Yes via Condition/Randomizer/Buttons/List | `VERIFIED` | Yes (`send_buttons`, `send_list`, `condition`, `randomizer`) | — |
| **Many-to-one (merge)** | Allowed (not forbidding — no doc bars it) | `INFERRED` | Allowed (BFS `visited` permits sharing target — no error) | — |
| **Branch merging after fork?** | Assume allowed | `INFERRED` | Allowed | — |
| **Loops / cycles** | Must be cycle-free or pause-gated; `30 blocks without a pause → pause automatically` runtime, but builder warns? | `VERIFIED` pause rule | Cycle detection at `findCycle` `src/lib/flows/validate.ts:921` DFS → error if cycle reachable from entry (newly added) | Need cross-Automation cycle guard for StartAuto recursion |
| **Self-loop** | `NOT DOCUMENTED` — likely disallowed (would be loop); Convox `findCycle` catches it (DFS stack includes self) | — | Error | — |
| **Unreachable nodes** | Allowed as draft; warning at publish ("Node X is unreachable from entry") (`VERIFIED` community sense, Convox implements warning) | `INFERRED` from Convox spec + sequence troubleshooting | Warning (not error) at `src/lib/flows/validate.ts:124` `severity: warning` | — |
| **Orphan / disconnected** | Warning (unreachable) not hard error, but publish needs at least entry → flow.hasNodes | per Convox `validateFlowForActivation:72` (entry required error) + unreachable warning | Same | — |
| **Duplicate edges** | Means duplicate `reply_id` or `node_key` edge: error (`VERIFIED` button duplicate `reply_id` checked at `src/lib/flows/validate.ts:384` + `src/lib/automations/validate.ts:163`) | `VERIFIED` | Error | Add `duplicate edges (same predecessor+target)` check separate from reply_id P1 |
| **Branch termination** | Terminal nodes `Allow closed/open?` — terminals have no outgoing; non-terminals missing `next` → error; branch missing follow-up → sequence troubleshooting says that sequential message won't fully send (warning) | `VERIFIED` for Action terminal vs others needing next | Non-terminal without `next` → error (`src/lib/flows/validate.ts:238` etc.) | Branch missing follow-up currently error for Condition branches (both required) but for Sequences branch fan merging missing is warning — align |
| **Implicit continuation** | None — every edge must be authored; there is no fallthrough | `INFERRED` (docs say "click connection dot and drag line to target step" for explicit wiring) | Explicit required | — |
| **Button-generated edges** | Each button creates its own geometric handle outgoing from Message node (`OBSERVED` screenshot hints) | `OBERVED` | Stored as array inside config not as separate edge rows; `validateFlowForActivation` checks each | Match visual handles at Convox `FlowCanvas` `src/components/flows/flow-canvas.tsx:1` — add per-button handle before claiming parity |
| **Quick-reply edges** | Grouped under buttons for TG/WA there is debated. Help Center groups quick replies under button behavior for TG/WA equivalence — mark `INFERRED` that quick reply also creates branch | `INFERRED` | Quick Reply via `InteractiveMessagePayload` covered | — |
| **Condition outputs representation** | `matching / not` labelled vs `true_next / false_next` vs `yes / no` (`OBSERVED` older vs newer docs vary) | `VERIFIED` both names appear | Convox uses `true_next/false_next` and `yes/no` — naming divergence cosmetic | — |
| **Randomizer outputs** | `variation[i].percent` + labelled edge handles | `VERIFIED` slider | `weight` (=percent) | — |

---

## 14. Node Visual / UI States

Evidence: `36000105060-flow-builder`, `14281166306332`, `14281198254620` preview docs, screenshots attached as `hc/article_attachments` PNGs in crawled pages.

| State | Trigger pill | Message | Action | Condition | Randomizer | Smart Delay | Start Automation | AI Step |
|-------|-------------|---------|--------|-----------|------------|-------------|------------------|---------|
| **Default** (canvas) | Pill at top showing `+ New Trigger` + chip list | Channel-colored rect (IG gradient vs FB blue — `INFERRED` palette), channel badge, stacked content previews truncated | Rounded rect with action icon + "N tasks" chip | Diamond with condition summary → 2 handles labelled Matching/Not or True/False | Split diamond with % labels on outputs | Hourglass with duration chip `Wait 2 hours → Next` or `Until YYYY-MM-DD` | Link icon with `Automation X` name | Chat bubble with goal summary (`INFERRED`) |
| **Selected** | Highlight border + left config panel opens (trigger picker) | Border accent + right handles visible | Same | Same + edge labels bold | Same | Same + menu controls | Same + picker modal on top | Same + tasks panel |
| **Hover** | `+ New Trigger` button lights | Duplicate (□) + Delete (🗑) appear top-right | Duplicate + Delete | Duplicate + Delete | Duplicate + Delete | Duplicate + Delete | Duplicate + Delete | `INFERRED` same |
| **Empty / incomplete** | Trigger chip gray with alert if no trigger active | Red outline (?) vs warning triangle — exact visual language `UNCERTAIN`; inferred incomplete badge (ManyChat doesn't document formal "incomplete node" badge — `UNCERTAIN`) | Missing `tag_id` = missing ref warning | Missing subject/branch target = error indicator | Missing `percent sum !=100` slider red | Missing duration/next = red outline | Missing `selected automation` = "Click to Select Automation" placeholder (dashed) | Missing goal/context = placeholder |
| **Valid** | Green check? (`UNCERTAIN`) | No badge, edge present | No badge | No badge | No badge | No badge | No badge | No badge |
| **Warning** | ⚠️ "will never trigger" banner (channel mismatch yellow) — `VERIFIED` warning note channel mismatch | Unreachable warning chip | — | — | — | — | Broken reference warning | — |
| **Error** | Red badge when trigger invalid? | Red badge + tooltip about `Will fail at publish` | Red badge | Red badge | Red badge | Red badge (left time ≥ right) | Red badge | Red badge (missing channel) |
| **Disabled/unavailable** | Trigger type grayed when channel not connected | Block/ action grayed when plan lacks it ("Some actions are not available on Free plan" `VERIFIED` `17636378650268`) | Same | Same | Same | Same | Same | AI Step grayed if Pro+AI add-on missing |
| **Expanded/editor state** | Full-screen left panel picker: trigger type → type-specific form (keyword list, match_type, channel, case_sensitive, etc.) | Right side: content blocks list; drag handle blue when hovering; Add Content Block `More` dropdown | Side panel: Task list + `+ Action` → Category picker → Task form (Add Tag → tag dropdown; Set Field → field picker + value input) | Side panel: `Does contact match all/any` toggle + `+ Add condition` row: field dropdown (Tag / List / Sequence / Time / System Field / CUF / Bot Field → value) → two drag outputs | Side panel: Variation rows with sliders + `+ New Variation` → drag to reorder | Menu panel: Duration/Date radio → Duration: amount+unit + `Set continue time limit` checkbox → time range + day filter; Date → Specific/Dynamic date picker → `Choose Next Step` | Modal picker: Search Automations → `Pick This Automation` → then dot-drag to next step | Full AI editor 3-step: Goal (textarea) → Context (10k) → Generate → tasks list (edit each + New Task + Save reply field + Test Chat widget `Save & Start Chat` / `Restart`) |

> **If exact visual details cannot be verified:** marked `INFERRED/UNCERTAIN` above per discovery. Convox must validate iconography/palette via live account capture before pixel-parity claim; behavioral parity is primary.

**Shared editor chrome (per `36000105060-flow-builder`):** top-right `Set Live` (publish), `Preview` dropdown, `Undo/Redo`, `Go to Basic Builder` toggle, instrument `+` bar, `Auto-arrange` (neatly organizes), zoom `+/-/fit`.

---

## 15. Node Editors

Pattern per Manychat `36000105060-flow-builder` + `17636378650268` etc.

### 15.1 Trigger editor (Starting Step → click → left panel)

```
Trigger Panel
├── Header: Starting Step summary + trigger chips
├── + New Trigger → Trigger picker grid (Events: User sends message (Keywords), Instagram Comments, Facebook Comments, Story reply, etc.; Ads: Click-to-Messenger/WhatsApp; Growth Tools remnants)
│   └── On choose:
│       ├── Channel picker (where applicable: Messenger/Instagram/Telegram/WhatsApp/SMS)
│       ├── Keyword list (≤10 per rule; text inputs + +Message condition for compound; intention vs explicit keyword toggle)
│       ├── Rules (dropdown: Message is / contains / contains like / begins with / Thumbs Up / doesn't contain)
│       ├── Priority drag (reorder keywords for precedence — VERIFIED 14281211785884)
│       ├── Scope (IG: Specific post/reel | Any post/reels | Next post/reel)
│       ├── Exclude/include keyword additional list (IG Comments)
│       └── Toggle: Active (toggle on to activate — VERIFIED "be sure to toggle the trigger on")
├── Validation: keywords≥1 (error if empty), channel mismatch warning (will never trigger)
└── Save → applies immediately (draft); Set Live publishes
```

### 15.2 Message editor (canvas node → click)

```
Message Panel (channel-specific: Messenger message vs Instagram message vs Telegram message etc.)
├── Header: Title (auto: "Message") + channel badge
├── Content Blocks stack (ordered)
│   ├── Block row: BlockIcon + type label + [X delete] [Duplicate] [Drag↕ handle]
│   │   ├── Text { textarea: text, char counter; Buttons subsection: + Add Button → button row { name ≤20, type picker (see Buttons §6), reply actions (Tag/User Field/Smart Delay/Start Automation/Select Existing Step) } }
│   │   ├── Image { Upload (+ URL) → preview, caption? }
│   │   ├── Audio / Video { upload → media checks (see Media guidelines 14281167455388) }
│   │   ├── File { attach }
│   │   ├── PDF { upload → preview in chat ("preview in chat" VERIFIED IG 2026-02-20) }
│   │   ├── Card { image + title + subtitle + buttons[] }
│   │   ├── Gallery { + Add Card → each card same fields, up to 10, optional buttons + action_url + image_aspect_ratio horizontal|square }
│   │   ├── Delay { durationMs, showTyping toggle (some channels) }
│   │   ├── Data Collection { reply_type dropdown (free text / multiple choice / phone / email etc.) → field picker (CUF/Bot Field) + + User Field to create CUF inline, multiple choices rows→branches, If not responded branch config + 30m note }
│   │   ├── Messenger List { list picker }
│   │   └── Dynamic { request_type POST|GET|PUT|DELETE, Request URL (HTTPS), headers table, body textarea, Test Request (contact picker → Response tab → Test), Fallback optional → Choose Fallback Step + Settings→Logs note } (VERIFIED 14281268533788)
│   └── More → add any other content type allowed for this channel (hidden unsupported types not shown)
├── Variables picker: { } button → CUF/System Field list
├── Button limits: enforce per-channel max (hidden typings — Call Number Messenger-only etc. VERIFIED "Available button types depend on connected channels and channel of text block")
└── Validation: text required, image URL/file required, Card/Gallery image+title/subtitle required, Dynamic HTTPS+fallback warnings; channel capabilities hide/disable
```

### 15.3 Action editor (standalone block → click)

```
Action Panel
├── Header: Actions
├── Task list (ordered, draggable)
│   └── Add / Remove Tag { tag picker (existing tags) }
│       Set / Clear User Field { field picker → value (variable) }
│       Delete Contact { confirm tag? }
│       Set Channel Opt-in/out { channel + status }
│       Set Bot Field { field picker → value }
│       Subscribe/Unsubscribe Sequence { sequence picker }
│       Make External Request { method dropdown + URL + headers map + body template + Test Request + fallback branch } (VERIFIED 14281285374364 / 14281285475484 Glitch test server)
│       Change Menu { menu picker } (Messenger-only)
│       Log Conversion { event + value }
│       Mark conversation Open/Closed { toggle }
│       Assign conversation { specific|group|round robin + assignee/group picker }
│       Notify Assignees { email/SMS channel + body (Notify Admins temp N/A on Msg per FB policy) }
│       Meta CAPI { event mapping }
│       + Integrations { injection per connected integration (Zapier, Sheets…) }
├── + Action → Category grid (Recently used / Contact data / Automation / Inbox / Ads Optimization / Integrations) (VERIFIED 17636378650268 screenshots)
├── Per-task validation: tag_id required, field+value required where Set, URL http/https only (+ SSRF considered), body JSON vs interpolation
└── Save/apply: tasks run sequentially until first fatal error (INFERRED warning vs fatal policy unclear)
```

### 15.4 Condition editor

```
Condition Panel
├── Does the contact match: [All | Any] toggle (VERIFIED)
├── Conditions (list):
│   └── + Add condition → picker: General filters (Tag, Widget, Ad, API opt-in, Messenger Lists, Sequence, Current time, Segments) + Fields (System | Custom User | Custom Bot → date offset formula + offset in days)
├── Comparison controls per row: operator/value depends on type (present/absent vs contains vs date offset)
└── Outputs: Matching → drag to target ; Not matching → drag to target (both required recommended)
```

### 15.5 Randomizer editor

```
Randomizer Panel
├── Variations list: Variation row { label input + % slider + edge handle } (2–12 rows)
├── + New Variation
├── Random path every time □ (unchecked default sticky — VERIFIED)
├── Sliders enforce sum=100 (red when !=100)
└── Note about batch distribution quirk shown inline (VERIFIED screenshot explains Ongoing vs One-time recommendation)
```

### 15.6 Smart Delay editor

```
Smart Delay Panel
├── Delay type: [Duration | Date] radio (VERIFIED 14281197046812 screenshots)
├── If Duration:
│   ├── Delay duration: number + unit dropdown (minutes/hours/days)
│   ├── □ Set continue time limit → Continue between HH:mm — HH:mm (validated left < right; red if violated)
│   ├── Days filter: [Any Day | Mon..Sun multi-check]
│   └── Choose Next Step (drag handle)
├── If Date:
│   ├── Dropdown: [Specific Date | Dynamic Date]
│   ├── Specific Date: datetime picker
│   ├── Dynamic Date: Custom User Field date picker + □ Offset → [+/-] amount + unit (minutes/hours/days) (+ before/after date)
│   └── Choose Next Step
└── Warnings: contact TZ else account TZ; Admin pause adds to timer; 24h window caveat (deliverability note + workaround link per channel: IG/Messenger special block types, WA template, TG none)
```

### 15.7 Start Automation editor

```
Start Automation Panel
├── Click to Select Automation (searchable list of active automations) → Pick This Automation
├── Preview of callee name/icon
├── Note: "will send all messages before returning, will not pause to wait for buttons/quick replies" (VERIFIED ⚠️)
└── Connection: dot → drag to Next step after return
```

### 15.8 AI Step editor (3-step wizard)

```
AI Step Wizard
├── Step 1 Generate: Goal textarea (prompt e.g., "Determine user's needs...") + Context textarea up to 10k chars (company, product, FAQs, tone, language) → Generate button (≤30s)
├── Step 2 Configure: Channel selector (if not first: auto-set from previous node — VERIFIED) ; Tasks list (AI-generated rows: each task label + edit pencil + Save reply checkbox → field picker System/Custom) + New Task button; Preview chat widget → Save & Start Chat / Restart
└── Step 3 Go Live: Trigger + Set Live
```

---

## 16. Builder UX

### 16.1 End-to-end flow

```
Automations (tab)
 → + New Automation (upper right) → Start From Scratch (upper right inside modal) OR pick Templates (clones into canvas, not live ref)
   → Flow Builder canvas opens with Starting Step (pill at top)
     → + New Trigger on Starting Step (picker → configure → toggle active)
     → Select first block (Message / Action / Condition ...) — "could be a message, action, or condition that sets the tone"
     → Configure block (right/left panel per type — see §15)
     → Connect via dot → drag to target node
     → Add more: round button upper-right / double-click empty canvas → pick step type (VERIFIED instrument bar & double-click flows)
     → Rearrange: drag handle; Shift+click or Shift+drag frame = multi-select (VERIFIED via Tips); Auto-arrange neatens layout (VERIFIED)
     → Copy/paste: Cmd/Ctrl+C/V inside same or across automations & between accounts; Alt+drag creates copy (VERIFIED) — cross-account paste may disable actions if target lacks Tags/Sequences
     → Undo/Redo: header buttons + Cmd+Z / Cmd+Shift+Z (VERIFIED "Switching back and forth... header undo/redo")
     → Rename automation (header title click)
     → Preview (dropdown → In Manychat widget vs In messengers native app — see §18)
     → Validate (implicit): channel mismatch ⚠️ yellow; incomplete nodes red (INFERRED); 30-block pause rule runtime
     → Publish: Set Live (top-right) — draft stays while previewing; modifying while previewing shows Restart suggestion (VERIFIED auto-restart prompt)
     → Post-publish: per-step stats + drop-off filterable by trigger appear (VERIFIED)
```

### 16.2 Toolbar, panels, features (observed list)

| Feature | Behavior | Evidence |
|---------|----------|----------|
| New automation flow | `Automations > My Automations > + New Automation` → modal with `Start From Scratch` (upper right) + Templates grid | `VERIFIED` `14281166306332` How to create |
| Blank automation | `Start From Scratch` = empty canvas + Starting Step | `VERIFIED` |
| Templates | Ready-to-go templates listed in same modal; clone on select, not live ref | `VERIFIED` `14281166306332` `14281111044124` |
| Starting node | Rounded pill dark connector dot draggable to change target | `VERIFIED` "Change Starting Step's first target by dragging dark dot connector" |
| Adding nodes | + icon → instrument bar (all blocks); double-click empty → pick type; round button upper-right corner | `VERIFIED` `36000105060-flow-builder` nav sections |
| Drag/drop | Drag handle on node; blue arrow highlight when viable | `VERIFIED` content-blocks drag description |
| Connection handles | Click connection dot on step → drag line to target step | `VERIFIED` Tips |
| Selecting nodes | Click node → editor panel | `INFERRED` from panel flows |
| Multi-select | Shift+click or Shift+drag frame to select multiple | `VERIFIED` Tips |
| Moving nodes | Drag any selected node; auto-arrange button for all | `VERIFIED` |
| Zoom / Pan | Zoom In/Out + fit-to-screen; pan via drag | `VERIFIED` |
| Auto-arrange | One-tap neat organize | `VERIFIED` |
| Duplicate | Square icon appears on hover | `VERIFIED` "Node: duplicate (□) + delete (🗑) icons appear on hover" |
| Delete | Trash icon on hover | `VERIFIED` |
| Copy / Paste | Cmd/Ctrl+C/V inside same or across automations and between accounts | `VERIFIED` `14281166306332` copy notes |
| Alt+drag | Creates copy | `VERIFIED` |
| Undo / Redo | Header buttons + Cmd+Z / Cmd+Shift+Z | `VERIFIED` |
| Node editor | Side panel opens on click | `INFERRED` from screenshots |
| Preview | Button top-right dropdown → `In Manychat` vs `In messengers` | `VERIFIED` `14281198254620` |
| Publish / live | `Set Live` button top-right | `VERIFIED` `14281166306332` final step |
| Rename | Header title | `INFERRED` |
| Toolbar / sidebars | Top header + Right sidebar (Flow/Basic toggle, instrument, zoom) + Footer zoom help + AI Assistant bottom chat | `VERIFIED` `36000105060-flow-builder` layout description |
| Folders | Organize via folders and naming (recommended for large accounts, `VERIFIED`; "no strict limit" on automation count — `VERIFIED` `manychat-model.md:22`) | `VERIFIED` |
| Responsive | `NOT DOCUMENTED` | — |

---

## 17. Validation Engine

### 17.1 Severity model

Manychat separates **ERROR vs WARNING vs INFO**. Convox `src/lib/flows/validate.ts:29` `severity: error|warning` + `scope: flow|trigger|node` + `field` mirrors this. Automation-level `validateStepsForActivation` uses simpler without `severity`. Align to publish-blocking (ERROR) vs publish-allowing (WARNING).

### 17.2 Graph validation (official vs Convox impl)

| Check | Manychat behavior | Blocks publish? | Convox today | Severity |
|-------|-------------------|-----------------|--------------|----------|
| Missing entry / missing trigger | Warning / Error (`Pick an entry node before activating` at `src/lib/flows/validate.ts:72` error; Trigger keywords≥1 error) | Error | Error | ERROR |
| Invalid edge (points to non-existent node) | Likely inline error per row | Error | Error | ERROR |
| Duplicate node_key | Error (DB UNIQUE catches) | Error | Error at `src/lib/flows/validate.ts:103` | ERROR |
| Duplicate reply_id / variant id | Error (`Duplicate button reply id ...` etc.) | Error | Error (`src/lib/flows/validate.ts:384` + `src/lib/automations/validate.ts:163`) | ERROR |
| Missing required field on node | Error (`text is required` etc.) | Error | Error | ERROR |
| Missing branch continuation (Condition one leg empty) | Warned: "If there is no follow-up ... that message won't be fully sent" (sequence troubleshooting) — so WARNING not ERROR? | WARNING | ERROR currently (condition requires both `true_next/false_next` `src/lib/flows/validate.ts:772`) | Align: relax to WARNING? |
| 30-block without pause | Runtime auto-pause, not save-block (`VERIFIED`) | INFO/WARN | Not enforced yet — gap P1 | WARN |
| Unreachable / orphan / disconnected nodes | Shown but flagged as unreachable (warn) | Warning | Warning at `src/lib/flows/validate.ts:125` | WARNING |
| Channel mismatch (trigger/channel vs node) | Warning "will never trigger" (`VERIFIED`) | Warning | `isValidChannel` error currently treats mismatch as error — gap: relax to warning per Manychat | WARNING |
| Randomizer sum !=100 | Error — "Variant weights must sum to 100" | Error | Error sum 100 (`src/lib/flows/validate.ts:894`) | ERROR |
| Smart Delay time window invalid (left ≥ right) | `OBSERVED` Error ("won't be able to publish ... if left-field is less than in right" per legacy `36000068629` support article) — not repeated verbatim in current `14281197046812`; treat as `OBSERVED` not `VERIFIED` primary | Error | Not yet (gap) | ERROR |
| Loop / cycle | Runtime auto-pause after 30? builder guard likely? `NOT DOCUMENTED` as publish block. Convox now DFS `findCycle` → error at `src/lib/flows/validate.ts:138` | Error | Error | ERROR |
| Cross-automation deleted reference (Start Automation target missing) | `UNCERTAIN` — warning | Warning | Not yet (gap) | WARNING |

### 17.3 Node validation (per-type)

Every node section §§4–12 lists required vs optional + `validateFlowForActivation` checks (`src/lib/flows/validate.ts:194` per node). Publish blocks on missing required / invalid value errors.

### 17.4 Channel validation

Builder hides unsupported content block types per channel (per §6 table). Validation mirrors hide rules (if somehow saved with unsupported combo via API, publish fails). Channel mismatch trigger never fires is warning (see above).

### 17.5 Where/how they are displayed

- Inline field highlight (`field` dot-path on ValidationIssue, e.g., `buttons.0.title`, `trigger_config.keywords` at `src/lib/flows/validate.ts:29`).
- Node badges: `node_key` attached to `scope: node` issues for builder to highlight exact input.
- Header warning bar for flow-level errors (`Cycle detected: ... → ...` etc.).
- During preview: toast `Restart preview to reflect latest changes` when editing.

---

## 18. Preview / Testing

### 18.1 Two modes (VERIFIED `14281198254620`)

| Mode | Where | Login needed | Exec scope | Limitations (VERIFIED) |
|------|-------|--------------|------------|------------------------|
| **In Manychat** | Smartphone widget inside Flow Builder, side-by-side with canvas | No | Current automation only (single flow) | Contact & third-party data exchange not rendered/updated/exported (Tag conditions manual choose path; Dynamic / Google Sheets / Zapier no I/O); Displayed elements: Text/Buttons/Quick Replies/Image/Delay/Card|Gallery/Audio/Video/Instagram DM List only as they would appear; Randomizer and Condition only visible to creator (must manually choose path); Other automations will not be previewed (Keywords/Default Replies/Start Automation won't preview); Non-content elements: Actions/Smart Delay/Start Automation will not be displayed nor executed; Data collection validation not enforced, image uploads not supported, Multiple Choice/not-responded cannot be previewed, Input validation skipped; Emails & SMS not supported. |
| **In messengers** | Native chat app (Messenger/Instagram/WhatsApp/etc.) | Yes (must be logged into respective app) | Full execution incl integrations, SMS/Email with phone/email input | SMS and email previews incur same charges as messages to subscribed contacts. |

### 18.2 Preview controls

- **Restart** via Refresh button (reruns whole automation from start).
- **Auto-restart prompt:** "If you modify the automation while previewing, you will see suggestion to restart the preview..." (`VERIFIED`).
- **Close:** closing widget discards chat history; reopening restarts from first step.

### 18.3 Tips (VERIFIED)

- Use `In Manychat` during early development for typos/structure/ordering.
- Switch to `In messengers` for final testing to ensure integrations + user interactions + data collection work.

### 18.4 Production testing gap

"ideal test is publish + live contact" per HighLevel wisdom in `builder-ux-model.md:34` — not separately documented for Manychat but implied by preview limitations.

### 18.5 Where preview intentionally differs from production

- Conditions: preview manual, production auto-evaluates (`VERIFIED`).
- Randomizer: preview visible as creator-only, production random/sticky (`INFERRED`).
- Data Collection: preview ignores validation & multiple choice branches (`VERIFIED`).
- Smart Delay: not displayed/executed in In Manychat; full wait in In messengers (`VERIFIED` Non-content elements note).
- Start Automation callee buttons/quick replies: production skips wait but preview not executed (`VERIFIED` for runtime as above).

---

## 19. Runtime Semantics (Conceptual Execution Model)

```
Trigger (Starting Step evaluated per inbound → enrollment gate)
  ↓ (matches channel + keyword + scope → creates execution)
Execution (per-contact, per-automation run: flow_run / automation_log)
  ↓
Node (current_node_key / step.position)
  ↓
State: { vars, tags, Bot Fields, Custom User Fields, Sequence subscription, current_channel snapshot }
  ↓
Next edge (deterministic: button reply_id match → branch; condition predicate; randomizer bucket; else sequential next; Wait timer; Action continue; AI completion; callee return)
  ↓
Node …
```

### 19.1 Core primitives

| Primitive | Contract | Convox evidence |
|-----------|----------|-----------------|
| **Contact execution state** | Per-contact run keyed by `(account_id, contact_id, automation/flow_id)` + `current_node_key` + `vars` + `status` | `src/lib/flows/types.ts:290` `FlowRunRow {status:active|completed|handed_off|timed_out|paused_by_agent|failed, current_node_key, vars, reprompt_count, trigger_channel, conversation_id}` + `src/types/index.ts:736` `Automation {execution_count, last_executed_at}` + `src/lib/automations/engine.ts:1` `runStep` caller `executeAutomation` |
| **Waiting state** | Suspending nodes: Message with buttons/quick replies (resume on `interactive_reply` id match), Data Collection (30 min), Smart Delay (timer+window), Start Automation returns (flush). Waiting visible as `Waiting` stats | `src/lib/flows/engine.ts:598` suspend path: `advanceCurrentNodeKey` + `flow_runs.current_node_key = node_key` + `FlowFallbackPolicy` reprompt/handoff; `src/lib/automations/engine.ts:297` Wait enqueues `automation_pending_executions {run_at}` |
| **Delays / Smart Delay** | Enqueue `automation_pending_executions {flow_run_id/context/next_node_key, run_at=now+duration, vars, trigger_channel, conversation_id, flow_id}` then `advanceCurrentNodeKey` to self + return `advanced` (suspend). Cron `resumePendingExecution` re-enters via `executeStepsFrom` / `advanceFromNodeKey` | `docs/specs/node-system.md:247` `engine.ts:915` waitMs → insert pending then suspend; Automation path `engine.ts:297` same table |
| **Branches** | Condition: `evaluateConditionNode` DB lookup (`src/lib/flows/engine.ts:607`) or `evaluateCondition` (`src/lib/automations/engine.ts:807`) with account scoping; Randomizer `mode sticky|random`; Buttons `matchReplyId(currentNode, incoming.reply_id)` (`src/lib/flows/engine.ts:75`) | `VERIFIED` |
| **Field mutations** | Tags `contact_tags` insert/delete scoped by account; CUFs `contact_custom_values` upsert after ownership guard; System fields similar; Built-in fields `contacts[name|email|company]`; Bot Fields global — Manychat tag/field writes map 1:1 to Convox `docs/specs/node-system.md:259` | `src/lib/automations/engine.ts:578` `contact_custom_values` upsert + `addContactTagAndDispatch` |
| **Automation invocation (Start Automation)** | Synchronous call: callee runs through messages (sending) without button wait, then returns to caller's `Choose Next Step` target. No new trigger evaluation for callee | `VERIFIED` note; `docs/specs/node-system.md:361` target P2 describes single call edge + continue |
| **Errors/Retries/Stopping** | `errors: webhook returned N → step failed`, `channel_target_missing → fail run`, `condition_unsupported field → throw`, `send_text_failed → failed`, `handoff → handed_off terminal`, `timed_out` via fallback sweep | `src/types/index.ts:301` `end_reason` + `src/lib/flows/engine.ts:575` handoff terminal etc. |
| **Concurrent automations / Duplicate executions** | Webhook `processNormalizedInbound.ts:1` loops active automations/flows `accountId` lookup then triggerMatches in creation order; channel filter respected; idempotency via `messages.meta_message_id` duplicate inbound ignored (`Duplicate inbound ignored` at `src/lib/flows/types.ts:398`) | `src/lib/automations/engine.ts:110` `runAutomationsForTrigger` per trigger + `processNormalizedInbound.ts:235` `dispatchInboundToFlows` then automations |
| **Runtime limits** | `30 blocks without a pause → auto-pause` at execution (VERIFIED); gallery 10 cards; messages per Dynamic 10; buttons per message 3/10 channel limit (enforce at Meta API) | `NOT ENFORCED` for 30-block today; media limits enforced at `src/lib/whatsapp/interactive.ts` validators |
| **Messaging restrictions** | 24h window after Smart Delay >24h (Regular message won't send — need Template/List/TON per channel `VERIFIED` `14281197046812`); Telegram exempt | Phase 3 channel-aware inbox (`docs/phase-3-channel-aware-inbox.md:1`) · Convox `INTERACTIVE_LIMITS` |
| **Tag added cascading** | Adding a tag fires `tag_added` automations with depth guard `MAX_TAG_CHAIN_DEPTH` to break loops | `src/lib/automations/engine.ts:495` `addContactTagIfAbsent` then `runAutomationsForTrigger(tag_added, depth+1)` + `src/lib/contacts/tag-events.ts:31` `addContactTagAndDispatch` |

### 19.2 Convox execution tables (recovered from Graphify)

- `flows {id, account_id, user_id, name, status, trigger_type, trigger_config JSONB, entry_node_id, fallback_policy JSONB, execution_count, last_executed_at}` (`supabase/migrations/010_flows.sql:77`, `src/lib/flows/types.ts:258`)
- `flow_nodes {flow_id, node_key, node_type, config JSONB, position_x,y}` (same file:114)
- `flow_runs {flow_id, account_id, user_id, contact_id, conversation_id, trigger_channel, status, current_node_key, last_prompt_message_id, vars JSONB, reprompt_count}` (same file:156)
- `flow_run_events {flow_run_id, event_type, node_key, payload}` (same file:216)
- `automations {account_id, trigger_type, trigger_config JSONB, is_active}` + `automation_steps {parent_step_id+branch yes/no, step_type, step_config, position}` (migration `006_automations.sql:14`)
- `automation_pending_executions {flow_run_id|automation, context:{next_node_key, vars, trigger_channel,...}, run_at, status:pending}` (`docs/specs/node-system.md:247` + `engine.ts:915`)
- `automation_logs {steps_executed[] {step_id,type,status:success|skipped|failed}, status success|partial|failed}` (`src/types/index.ts:803`)

---

## 20. Analytics

### 20.1 Automation-level (VERIFIED & OBSERVED)

From `manychat.com/blog/product-update-manychat-analytics` (2020, updated reference still cited in `14281197046812` + community 2026 threads `959...`, `9150`):

| Level | Metrics | Where | Notes |
|-------|---------|-------|-------|
| **Automation / Flow** | Sent (trigger fires count) · Open Rate (DM open rate) · CTR (first-step CTR) · Unique subscribers (entered) · Total times sent (including repeats) · Revenue earned + conversion events (when Pixel/Conversion Action inserted) · Contact info collected | Flow view stats above charts; folder earned column; Dashboard Metrics tab `VERIFIED` (earned, ARPPU average revenue per paying user, APC avg payment count, Sales, Buyers, revenue graph per day, conversion events graph, Highest Revenue Flows) | Only cumulative totals per automation; no historical/time-based analytics for single automation — need to duplicate to get clean data after optimizing (`OBSERVED` `9150` "ManyChat currently doesn't provide historical or time-based analytics for a single automation. You only see cumulative totals.") |
| **Trigger** | Per-trigger stats filterable + Search by trigger / Search by trigger state | `VERIFIED` `14281111044124` "Search by triggers ... Search by trigger state (active/disabled)"; "views/analytics filterable by trigger" `14281166306332` FAQ |
| **Node/step** | Per-step delivery/open/click rates + Starting Step Conversion Rate (number who reached step ÷ unique starters — returns excluded) | `VERIFIED` `manychat.com/blog/product-update-manychat-analytics`: "By clicking individual message step, stats update to include delivery rates, open rates, click rates, and Starting Step Conversion Rate." |
| **Smart Delay** | **Overall** (total who entered) · **Waiting** (currently delaying) · **Passed** (completed → next) with Total+Unique on click per block | `VERIFIED` `14281197046812` + stats image `24005804574364` |
| **Sequence message** | Stuck / not-subscribed / timing / duplicate issues condition checklist (see `14281202572316` troubleshooting) — stats include enabled per-message + sequence online if ≥1 enabled | `VERIFIED` `14281202572316` |
| **Conversion** | Action Step Conversion (custom; assign revenue value that is "earned" per flow occurrence) + Manychat Pixel conversion (site action after clicking Messenger button) — 5 types: 3 automatic + 2 custom (`VERIFIED`) | `VERIFIED` `manychat.com/blog/product-update-manychat-analytics` |

### 20.2 What Manychat does NOT track this way

- No version-history analytics (`NOT DOCUMENTED` for Automations beyond undo/redo).
- No per-trigger *Unmatched* breakdown (HighLevel parity is `Attempted/Matched/Unmatched` per trigger — Manychat shows filtered by trigger but unmatched not labeled separately).

### 20.3 Convox mapping

Convox has fewer surfaces: `flow_run_events` + `automation_logs {steps_executed:{success|skipped|failed}}` + `broadcast_recipients` per-template send status + `flow_runs.status` (waiting/failed/completed). Gap: add `Starting Step Conversion Rate` per node, Smart Delay unique vs total, revenue attribution (P4), 30-day window filters.

---

## 21. Pro-Specific Scope

### 21.1 Pricing truth (as of 2026-03-02 migration, live-crawled 2026-09-02)

| Dimension | Free (`VERIFIED` `14281211785884` + `community 9591`) | Essential (implied) | **Pro** | Business/Advanced (beyond Pro) |
|-----------|------------------------------------------------------|--------------------|---------|--------------------------------|
| **Monthly price (annual)** | — | `OBSERVED` $14–$15 (some docs show 500 contacts) | **$29/mo ($348/yr)** (`VERIFIED` `25800228332572` + `manychat.com/pricing`) — older docs show $25, but new pricing round is **$29** as of pricing page live fetch | Higher |
| **Active Contacts included** | 25 per article `14281211785884` (3 keywords limit note), but Help Center Home shows **1,000 contacts at no charge** (FAQ 8982), community reports 1,000 on free post-2026 — **`UNCERTAIN` exactly until pricing migration complete; we report 1,000 per newest FAQ as primary, 25 as legacy** | tiered | **2,500** (`VERIFIED` Pro plan) + overage ~$0.05/extra contact (`OBSERVED` `creatorlanehq.com` "roughly $0.05 each") | 7,500+ (`VERIFIED` Pro vs Business threshold) |
| **Channels** | IG / Messenger / TikTok (Beta) (`VERIFIED` FAQ "Standard automation triggers for Instagram, Facebook, and TikTok (Beta)") | — | **Up to 3** chosen from Instagram/Messenger/WhatsApp/SMS/Email (`VERIFIED` `25800228332572`): "Connect up to 3 channels, choosing from: Facebook Messenger ..." + old docs include Telegram as channel but not in newest pricing channel list — `UNCERTAIN` whether Telegram counts after 2026-03 | More Inbox seats |
| **Automations** | Unlimited? (`VERIFIED` unlockdm "Flows are free. You can build fifty on Free plan.") | Unlimited | **Unlimited**, including advanced across multiple channels | Same |
| **Inbox seats** | — | — | **2 seats** + up to 3 total, extra $25/seat (`VERIFIED` `25800228332572`) | More required beyond 3 |
| **What unlocks at Pro** | Lead capture, tags, Google Sheets sync, unlimited automations already unlocked; but **Conditions, Smart Delays, external integrations (Zapier/CRM/Sheets), Actions category beyond basic on Free vs Rules tab distinction, WhatsApp channel, broadcasts with advanced, AI, Inbox labels & rules, API** (`VERIFIED` FAQ "Unlimited ... Advanced Channels: WhatsApp, SMS, Email ... High-Level Tools: Conditions, Smart Delays, and external integrations") + `17636378650268` "Some actions not available on Free" | — | **AI Step requires extra $29 AI add-on even on Pro** (`VERIFIED` `manychat.com/product/ai` "*AI only available as add-on to Manychat Pro*"; `creatorlanehq.com` "AI features (the AI Step) aren't included in any plan — extra $29/month on top of Pro or Business") | Pro+AI $58 total |

### 21.2 Pro vs non-Pro vs channel-dependent vs integration-dependent

```
PRO (included with Pro subscription):
  Unlimited automations, multi-channel broadcasts, Sequences, Rules global triggers,
  Conditions/Smart Delay (advanced tools), Custom labels & inbox rules, Email/SMS CRM integrations,
  API access. Price $29+overages.

NOT in Pro without extra pay:
  AI Step / AI Replies / AI Comments / Flow Builder Assistant's richer generative features — $29 AI add-on.

CHANNEL-dependent (not plan):
  WhatsApp infrastructure surcharge: Meta per-conversation fees $0.005–$0.10 (region/category) on top of Pro (`VERIFIED` setsmart.io).
  Telegram File/Audio/Video/Messenger List presence depends on channel block matrix, not plan.
  SMS A2P 10DLC registration costs (carrier-side) — not Manychat's pricing.

INTEGRATION-dependent (not plan):
  Zapier/Google Sheets/Dynamic Block/External Request — connectivity requires connected account;
  Zapier actions: Add Tag, Create Subscriber, Remove Tag, Send Content/Dynamic/Text, Set Custom Field, Subscribe/unsubscribe Sequence (`VERIFIED` 14281281340188).
  Conversions API event — requires Meta Pixel/CAPI wiring.
```

**Implication for spec's "Manychat Pro parity" scope:** Target Pro with WhatsApp+Telegram available, AI Step as optional add-on (document but don't count as Must Match; `SHOULD MATCH` behind flag). SMS/Email automations can be documented as `SHOULD` but not `MUST` for Convox WA/TG focus.

---

## 22. Connection Compatibility Matrix (visual — see §13 for detailed rule table)

```
Can receive from / Can connect to:
               Trigger  Message  Action  Condition  Randomizer  SmartDelay  StartAuto  AI Step
Trigger           —       ✓       ✓        ✓          ✓          ✓          ✓        ✓(I)
Message          ✗       ✓       ✓        ✓          ✓          ✓          ✓        U
Action           ✗       ✓       ✓        ✓          ✓          ✓          ✓        U
Condition        ✗       ✓       ✓        ✓          ✓          ✓          ✓        U
Randomizer       ✗       ✓       ✓        ✓          ✓          ✓          ✓        U
SmartDelay       ✗       ✓       ✓        ✓          ✓          ✓(I)       ✓        U
StartAuto        ✗       ✓       ✓        ✓          ✓          ✓          ✓(U)     U
AI Step          ✗       ✓(I)    U        U          U          U          U       I

✓ VERIFIED allowed (generic sequential any block allowed as next)
✓(I) INFERRED but very likely
U  UNCERTAIN (no doc forbids but no doc confirms)
—  Forbidden (nothing can connect to Trigger; Trigger is envelope only)
```

Rows = predecessor, Columns = successor. Manychat does **not** explicitly document a restriction where some successor types are forbidden — `manychat-model.md:197` states "don't assume everything is freely connectable ... If Manychat does NOT explicitly document a restriction, say so." So this matrix is **default-allow** with documented top-level exceptions (Trigger never as target; content blocks only inside Message). Until we observe a counterpart block denying inbound from e.g., Randomizer, we leave it allowed.

---

## 23. Node Configuration Matrix

| Node | Config fields | Required | Optional | Defaults | Allowed values | Dynamic vars | Validation error if missing | Warning if mis-configured |
|------|--------------|----------|----------|----------|----------------|--------------|-----------------------------|---------------------------|
| Trigger (generic) | `trigger_type` + per-type fields + `channel` + `toggle active` | `trigger_type`, per-type required set | `channel` (any=default), `case_sensitive`, `match_type` default `contains` | `channel:any`, `case_sensitive:false`, `match_type:contains` | see §5.2 per-type | none captured here | `at least one keyword is required` etc. at `14281166306332` | `will never trigger` (channel mismatch) |
| Message (container) | `channel_block_type` implicit; `content_blocks[]` 1..N each per §15.2 | ≥1 content block | Multiple blocks, drag reposition | first block Text empty storyboard | `INTERACTIVE_LIMITS` | `{{CUF}}` in Text + button title ≤20 total | `Text required` / `File required` etc. | Gallery >10 cards etc. |
| Action | `tasks[]` ordered | ≥1 task | reordering | — | per category | `{{field}}` in Set field values | `tag is required` etc. | cross-account paste may disable actions (tags/sequences missing) |
| Condition | `all|any` + `conditions[]` rows each `(field type → value + operator)` | ≥1 condition, both branch targets recommended | additional conditions | `any` | Tags/Fields/Lists/Sequences/Time/Segments | field references as strings | `At least one condition + both branches connected` UNCERTAIN for block at save | Yellow warning if missing follow-up |
| Randomizer | `variations[] {label, percent next}` + `random_path_every_time □` | 2–12 variations, sum 100, each `next` | mode sticky/random | 2 vars 50/50, unchecked | 2–12, percent 0–100 slider | none | `At least 2 variations; sum must be 100` | batch skew note (governance, not error) |
| Smart Delay | `type Duration|Date` + Duration fields (`amount, unit, continue time window, day filter`) vs Date fields (`Specific datetime | Dynamic Custom Field date ± offset unit`) + `Choose Next Step` + `next` | `amount≥1, unit ∈{m,h,d}` OR `datetime/Dynamic field`; `next` | continue window, day filter, offset | duration unit minutes | window left<right; max 365d; contact TZ fallback | none | `left time ≥ right` can't publish | 24h window caveat not error, info link per channel |
| Start Automation | `callee_automation_id` | existing id | — | — | pick from active automations list | — | `Click to Select Automation` placeholder = error | broken reference warning |
| AI Step | `goal, context (≤10k), channel, tasks[] {label, Save reply→field}, preview Chat` | `goal`, `context`, channel (when first), ≥1 task? `UNCERTAIN` | tasks optional? Actually auto-generated tasks but editable | channel auto from previous node when not first | per-channel support {Messenger/Instagram/WhatsApp/TikTok/Telegram} | Tasks save to System/Custom Field | missing goal/context = disabled Generate | missing field reference warning |

---

## 24. Channel Compatibility Matrix

Per `14281196200604` (2026-03-19 final, source-of-truth until Help Center re-updates). Use for both **builder authoring filter** and **publish validation**.

| Content Block / Feature | IG | Messenger | TikTok | Telegram | SMS | Notes for Convox |
|-------------------------|----|-----------|--------|----------|-----|------------------|
| Text (+ buttons) | ✓ ≤3 btn | ✓ ≤3 | ✓? text-only inferred | ✓ ≤10 | ✓ ≤? assume ≤3? `UNCERTAIN` | WA/IG/Msg=3, TG=10 (`VERIFIED` btn limits) |
| Image | ✓ | ✓ | ✓ | ✓ | ✓ | via `send_media image` |
| Delay (inside Message) | ✓ | ✓ | ✓ | ✓ | ✗ | Not standalone pause |
| Data Collection | ✓ | ✓ | ✓ | ✓ | ✓ | ≤30 min wait |
| File | ✗ | ✓ | ✗ | ✓ | ✗ | Messenger List hidden on IG |
| Audio | ✓ | ✓ | ✗ | ✓ | ✗ | 16MB limit |
| Video | ✓ | ✓ | ✗ | ✓ | ✗ | 16MB, 25MB Messenger |
| PDF | ✓ (since 2026-02) | `UNCERTAIN` | ✗ | `UNCERTAIN` | ✗ | IG-only verified |
| Card | ✓ | ✓ | ✗ | ✗ | ✗ | 1.91:1 aspect |
| Gallery (≤10) | ✓ | ✓ | ✗ | ✗ | ✗ | each card optional buttons |
| Messenger List | ✗ | ✓ | ✗ | ✗ | ✗ | List subscription filter only Messenger |
| Dynamic (HTTP) | ✓ | ✓ | ✗ | ✓ | ✗ | POST/GET/PUT/DELETE HTTPS + v2 format |
| Call Number button | ✗ | ✓ Messenger-only | — | — | — | `VERIFIED` "Call Number Messenger-only" |
| Smart Delay | ✓ | ✓ | `UNCERTAIN` | ✓ | `UNCERTAIN` | Neutral but deliverability docs IG/Messenger/WA/TG-specific |
| Condition tags/fields | ✓ | ✓ | ✓ | ✓ | ✓ | Neutral |
| Sequence subscribe | ✓ | ✓ | ✓ | ✓ | ✓ | Neutral |
| Ads Optimization CAPI | `INFERRED` IG/Msg ads related | ✓ via Pixel | — | — | — | Needs Pixel |
| Quick Automation (comment→DM) | ✓ IG Post & Reel only | ✗ | ✗ | ✗ | ✗ | Simplified alternative, not separate engine |

> **Implementation:** `src/lib/automations/unified-taxonomy.ts:31` `UNIFIED_CATEGORIES` already has `communication|input|logic|timing|crm|integration|control`; `docs/specs/channel-capabilities.md` (canonical matrix per `builder-ux-model.md:2`) should be the single source for `hostsOf()` gating in builder + `validate*` parity. Current Convox matrix is `WhatsApp vs Telegram (implemented) + Extended (research)` per `.

---

## 25. Unknowns / Unverified Behavior

| # | Unknown | Why it matters for Convox | Classification | Next verification step |
|---|---------|---------------------------|----------------|------------------------|
| 1 | Exact top-level instrument bar order and **complete list** of block titles as seen by Pro account with all channels connected (vs screenshots that are channel-filtered) | Drives taxonomy completeness (do we miss a canvas block?) | `UNCERTAIN` | Create Pro account with IG+Messenger+WhatsApp+Telegram connected and screenshot the `+` / double-click picker across all channels. Compare against builder `ADDABLE_STEPS` at `src/components/automations/automation-builder.tsx:1` (`ADDABLE_STEPS`) and `src/components/flows/flow-canvas.tsx:1` `NODE_TYPES` |
| 2 | Whether Pro's 1,000 contact Free allowance is now **1,000** (FAQ 8982) vs **25** (legacy article 14281211785884) — which is prod truth after Mar-02 pricing migration | Affects pricing parity claims and limits table | `UNCERTAIN` | Re-crawl `help.manychat.com/hc/en-us/articles/14281211785884` with `Free plan limit` search after migration country rollout; capture date on screenshot |
| 3 | Randomizer exact ceiling post-2026-04: official Help Center still says 6 but community says **12** — which is publishing validator truth | Affects `validate*` sum/count tests | `UNCERTAIN` (community OBSERVED, Help Center outdated) | Check `help.manychat.com/hc/en-us/articles/14281151100060` revision date (currently 2025-11-27) — expect update to 2026-04-07; test slider max via live account |
| 4 | How buttons **Create (editable) vs Persist** — are reply_ids auto-generated vs manual? Can duplicate across messages? | Affects Convox `reply_id` uniqueness scope (per node vs per flow) | `UNCERTAIN` for exact UX title length warning vs save-block | Capture builder typing into button name field with counter ≤20 |
| 5 | Whether `Start Automation` recursion / self-loop is guarded at publish (cycle detection) | Convox needs graph-level loop guard for callee edges | `NOT DOCUMENTED` | Attempt to wire A→B→A with test automations; note warning text |
| 6 | Exact node visual states `Empty/incomplete vs Valid vs Warning vs Error` badge/icon/palette | Drives builder design tokens & `ValidationIssue.severity→visual` | `INFERRED` (screenshots partial) | Screenshot empty node, invalid node (missing tag), channel mismatch warning node |
| 7 | AI Step branching: does completion always go to single `next`, or does AI have per-goal branch outputs? Does failure/handoff have implicit branch handle? | Affects `AI Step` graph representation type count | `NOT DOCUMENTED` in Help Center beyond "Choose Next Step" style — mark as 1 outgoing until verified | Reach AI Step editor and attempt to drag second output |
| 8 | What **Analytics > Conversion tracking** types are available in current Pro Dashboard (was 5 types 2020 blog — still true in 2026?) | Parity claims about analytics parity | `NOT DOCUMENTED` current 2026 dashboard | Cross-check Dashboard → Metrics tab screenshots current |
| 9 | Trigger priority when multiple automations listen to **same keyword** (order precedent vs docs) — IG Comments definite oldest-wins, but keyword collision? | Determines enrollment determinism | `UNCERTAIN` | Fire same keyword in two Active automations and capture which runs |
| 10 | Convox's `send_list` Telegram flattening (`flatMap section.rows→inlineKeyboard` at `src/lib/flows/engine.ts:517`) — does Manychat Telegram actually flatten list → buttons or disallow list? Table says TG lacks Gallery/List | `INFERRED` good compatibility but not Manychat-verified for lists on TG | Verify TG List in live Manychat Telegram picker — likely disallowed (hidden), matching table |

---

## 26. Implications for Convox

### 26.1 Architectural principle (from brief §23)

```
MUST MATCH — User-visible capability/behavior important for parity.
SHOULD MATCH — Useful UX/behavior worth copying.
DON'T COPY — Manychat implementation decision that would unnecessarily complicate Convox.
```

| Principle | This spec's guidance |
|-----------|----------------------|
| **MUST MATCH** | Channel-aware authoring (hide unsupported blocks/buttons/limits per channel; validate mirroring hide). Pause semantics (buttons/DataCollection 30m/Smart Delay). Per-button reply_id branching. Condition `all|any` groups. Randomizer sticky (persistent bucket) + sum=100 + now-12 variations. Smart Delay Duration+Date+continue window+contact TZ (without breaking TG no-window). Start Automation synchronous call that flushes messages then returns without button wait. 30-block-without-pause runtime guard + publish hint. Per-step analytics (Starting Step Conversion Rate) + Smart Delay waiting/passed. |
| **SHOULD MATCH** | Content Block container inside Message (one canvas node holding Text+Image+Button together — vs today's flat per-type nodes). Double-click canvas + `+` & instrument bar creation; dot→drag wiring; auto-arrange; multi-select; Alt+drag duplicate; cross-automation copy/paste with sanitized refs; Undo/Redo + dirty/saved/published split; `In Manychat` vs `In messengers` preview variants; per-trigger filtration of stats; Folder/Templates clone-on-use + workflow switcher (`Shift+W`). |
| **DON'T COPY** | Manychat's dual-model remnants (Basic vs Flow as view but persisted with different naming; manychat still has Sequence as separate first-class drips where Convox can model as reusable Wait chains + `sequences` table already exists but not first-class workflow — don't over-invest in legacy Messenger List subsystem unless a partner demands). Don't copy IG Comments "first comment per user per post" dedup semantics literally for WA/TG beyond proper channel idioms. Don't copy 365-day max as single constant if business wants longer — expose as configurable cap. |

### 26.2 Mapping — Manychat concept → Convox equivalent (verified via Graphify + `docs/specs/node-system.md:1`, `src/lib/flows/types.ts:1`, `src/types/index.ts:1`)

| Manychat concept | Convox equivalent | Notes |
|------------------|-------------------|-------|
| Automation (My Automations) | **`automations` OR `flows`** — today two top-level tables. Target: unify or bridge; today Flows = graph (`flow_nodes` + `flow_runs`), Automations = sequential + branched steps (`automation_steps.parent_step_id+branch`). | `docs/specs/node-system.md:355` connection contract covers both hosts. |
| Starting Step / Trigger | `FlowTriggerConfig` (`keyword|first_inbound_message|manual` at `src/lib/flows/types.ts:249`) + `AutomationTriggerType` enum (`src/types/index.ts:482`) with `trigger_config JSONB` + `entry_node_id` | Flows limited to 3 types; Automations already richer (`keyword_match`, `tag_added`, `interactive_reply`, `contact_changed`, `note_added` etc.). Manychat Rules' global triggers → Convox's Automation triggers cover most, but `Date/Time` not yet. |
| Message (container → Content Blocks) | **Currently flattened** → `send_message` / `send_buttons` / `send_list` / `send_media` nodes (`src/lib/flows/types.ts:30`). **Target:** one `send_message` node with optional multi-block inner list + `buttons` mapping to text+buttons blocks. | Convox builder `src/components/flows/flow-canvas.tsx:1` + `src/lib/flows/types.ts` validators reflect flattened view; adding container simplifies authoring (one node hold text+image+buttons). |
| Content Block: Data Collection | `collect_input {prompt_text, var_key, validation, next_node_key, channel_target}` (`src/lib/flows/types.ts:124`) | Flows-only today per `unified-taxonomy.ts:99` hosts; add `timeout_branch` + validation enforcement P2. |
| Content Block: Delay (typing pause) | `Delay inside Message` (sub-block) — not standalone graph node | `docs/specs/node-system.md:151` Delay inside Message; P2 add as optional content block. |
| Content Block: Dynamic | Not yet graph node (exists as `src/lib/automations` webhook vs content mapping?). Actually Dynamic maps to `External Request`/`Dynamic` via `src/lib/flows/types.ts` comment "Allowed Flow http_fetch in DB CHECK but not runtime" (`docs/specs/node-system.md:331`) | Target P2: `http_fetch`/Dynamic variant with method+response mapper + fallback branch. |
| Action (multi-task) | `automation_steps` type groups `add_tag|remove_tag|update_contact_field|create_deal|assign_conversation|send_webhook|...` but Automations store these as sequential steps, not grouped multi-task inside single canvas node. Flows have `set_tag` single node (`src/lib/flows/types.ts:183`) | Target: `Action Node` container holding N tasks sharing one canvas node + one `next`. |
| Condition | `ConditionNodeConfig {subject var|tag|contact_field, subject_key, operator equals|contains|present|absent, true_next/false_next, conditions[]+match all|any}` (`src/lib/flows/types.ts:158`) + `ConditionStepConfig` (`src/types/index.ts:690`) | Already unified P1 (multi-condition `all|any` added); needs date-offset operators to match Manychat formulas. |
| Randomizer | `RandomizerNodeConfig {variants:[{id,label,weight,next_node_key}], mode sticky|random}` (`src/lib/flows/types.ts:197`), `RandomizerStepConfig` (`src/types/index.ts:665`) — both 2–6, sum 100 + sticky/random already `P2` spec but wait validation max 6 should be 12 | Update validator to ≤12 |
| Smart Delay | `WaitNodeConfig {amount,unit,until,next_node_key}` (`src/lib/flows/types.ts:190`) + `WaitStepConfig {amount,unit,until}` (`src/types/index.ts:683`) — **Duration (+ `until` date) only** + no continue-window | Needs Window+Day+Contact TZ+Admin pause extension to reach §10 full. |
| Start Another Automation | `interactive_reply` trigger chaining across automations + generic webhook trick (`src/lib/automations/engine.ts:807` `evaluateCondition` + `src/lib/flows/engine.ts:75` reply match) but **not graph edge** (`docs/specs/node-system.md:361` reusable `P2 — not yet graph-level`) | Build graph-level callee reference + sync flush semantics (skip button wait) |
| AI Step | No graph primitive; AI lives as `ai_knowledge_chunks` / `ai/knowledge` semantic match + auto-reply fallback | Add `ai_step` node type P3/P4 with goal/context/tasks + chat simulation + save-to-field |
| Basic vs Flow editors | `src/components/automations/automation-builder.tsx:1` `ADDABLE_STEPS` + `src/components/flows/flow-canvas.tsx:1` + `provider.tsx` `TriggerPanel` | Target: single persisted graph rendered linearly vs map (see §2.2) |
| Validation | `src/lib/flows/validate.ts:1` `validateFlowForActivation` (140+ edges `reachableFromEntry` + `outgoingEdges`) + `src/lib/automations/validate.ts:1` `validateStepsForActivation` | Fix TG button cap now patched for Automations (`validateChannelTarget` branch) but flows `send_list` TG flatten not validating against TG caps — carry gap; add Smart Delay window validation + 30-block pause warning + channel-mismatch warning vs error. |
| Preview/Test | `src/lib/flows/engine.ts:1140` `dispatchInboundToFlows` + `src/lib/automations/dry-run.ts:1` `previewAutomationSteps`/`previewFlowNodes` + `src/components/automations/test-dialog.tsx:1` | Add In Manychat (limited) vs In messengers (full) split; fix trust gap per `builder-ux-model.md:31`. |
| Analytics | `flow_run_events` + `automation_logs {steps_executed:success|skipped|failed}` + broadcast counts | No per-step conversion rate vs dashboard Metrics — add per-node attempted/matched/waiting graphs. |
| Pro gating | `017_account_sharing.sql` roles + `profiles` roles but no feature entitlement table | Gate AI Step, extra channels, CAPI behind Pro-like entitlement (per §21). |

---

## 27. Convox Parity Matrix (Manychat capability × Current Convox → Gap → Required Behavior → Priority)

| Manychat capability | Current Convox | Gap | Required behavior to claim parity | Priority |
|---------------------|---------------|-----|-----------------------------------|----------|
| **Message container holding multiple content blocks (Text+Image+Delay+Buttons together)** | Flattened: `send_message` vs `send_buttons` vs `send_list` vs `send_media` are separate graph node types (`src/lib/flows/types.ts:30`) | No container — authoring is multi-node sequence instead of one multi-block message | Single Message graph node with ordered `content_blocks[]` each per §15.2 + buttons as sub-block | P1 |
| **Card / Gallery blocks** | No `card/gallery` node types (Flows `send_media` is image|video|document single, no carousel) | Missing | Add `send_card` / `send_gallery` (up to 10 cards) + Telegram File generic mapping; hide per channel if unsupported | P2 |
| **Messenger List** | No | Missing | Messenger-only List opt-in content block + 2 filters (`List subscription available right now`/`Subscribed to List`) | P3 (channel-specific) |
| **Dynamic block (GET/POST/PUT/DELETE + fallback + response `v2` format)** | `http_fetch` allowed in DB CHECK but not runtime (`docs/specs/node-system.md:331`); `send_webhook` only on Automations | No runtime for Dynamic inside Message; no fallback branch | Promote to both hosts with `request_type+url+headers+body+TestRequest+fallback_next`; log to `Settings→Logs` mirror | P2 |
| **Data Collection — Multiple choice branches + 30-min wait + validation + not-responded branch** | `collect_input` suspended but validation ignored (`runner ignores in v1.5` per `docs/specs/node-system.md:172`); no multiple-choice branching; no timeout branch | Incomplete | Add `timeout_next` + `reply_type` branching + email/phone validation enforcement in runner | P1 |
| **Action multi-task per node (Add Tag+Set Field+Subscribe in one block)** | Flows: single `set_tag` node per action; Automations: sequential single-purpose steps | Single purpose per node → fails parity | Action Node container with N ordered tasks + single `next`; runtime loops tasks sequentially | P1 |
| **External integrations (Subscribe/Unsubscribe Sequence, CAPI, Integrations injection)** | Sequences exist (`14281202572316` note) as domain objects (`src/types/index.ts:767` `Sequence`) + `enroll_in_sequence` step; CAPI no node; integrations list per  `17636378650268` | Partial | Wire `Subscribe/Unsubscribe Sequence` as Action tasks + expose Integrations plug-in slot for Sheets/Zapier mapping | P1/P2 |
| **Condition `all|any` groups + date offset formulas** | P1 shipped `conditions[]+match all|any` (`src/lib/flows/types.ts:173`) but date offset still via `System/Bot fields` formula not typed | Partial gap | Add date field comparison with formula offsets (e.g., `coupon_date > issuance+3d`) + tag/widget/ad/list/Sequence filters (currently `var|tag|contact_field` narrow) | P1 |
| **Randomizer sticky bucket persistence + distribution correctness** | `randomizer` 2–6, sum 100 already; `mode sticky|random` prepared; bucket table not yet | Not persisted — sticky resets | Persist `contact_randomizer_bucket {flow_id, node_key, contact_id, variant_key}` assigned on first visit; batch skew is Manychat bug — Convox can be correct | P1 |
| **Randomizer now up to 12** | validators enforce ≤6 (`src/lib/flows/validate.ts:870`) | Cap outdated | Update to ≤12 + Help Center still says 6 — update validators after official doc bump | P1 (small) |
| **Smart Delay Duration continue-time window + day filter + contact TZ + admin pause extension** | Duration `amount+unit` (+ optional `until`) only; no window; no TZ handling in Wait; no max 365d cap; no day filter (`src/lib/flows/types.ts:190`) | Missing core | Expand Wait→ Smart Delay: `continue_window{HH:mm-HH:mm}` + `days: Any|weekdays` + `timezoneBehavior: contact else account` + `adminPauseAdd` + `max 365d`; validation left<right | P1 |
| **Smart Delay Date (Specific/Dynamic + offset)** | `until` already accepts ISO datetime (`src/types/index.ts:686` & `src/lib/flows/types.ts:192`) | Dynamic date via Custom Field ± offset missing | Add Dynamic Date: `dateSource: CUF date → offset +/- N unit` | P2 |
| **30-block-without-pause auto-pause** | Not enforced anywhere (Graphify communities `flows/engine.ts` `validateFlowForActivation` no 30 check) | Missing | Runtime guard: `if sequential_blocks_without_pause ≥30 then pause (insert pending at next pause node or handoff)` + publish warning | P1 |
| **Start Another Automation (sync flush, skip button wait, return)** | `interactive_reply` chaining; not graph-level Start Auto (`docs/specs/node-system.md:361` reusable P2 — not yet) | Not parity | Graph edge type `start_automation {calleeId, next}` with `executeCalleeSynchronouslyFlush` (sends callee messages, skips interactive suspend, returns to caller's `next`) | P1 |
| **AI Step (goal+context 10k + tasks + save-to-field + channel auto)** | No node; AI is global `auto-reply`/`knowledge` off-runner | Missing | Add `ai_step` node type with wizard editor (`goal, context, tasks {label, saveToField}, Test Chat widget`) + delegation to LLM loop similar to `src/lib/ai/knowledge.ts:1` | P3/P4 (behind Pro+AI flag) |
| **Multiple triggers OR per automation** | Flows: single `trigger_type` envelope (`src/lib/flows/types.ts:269` single); Automations: single `trigger_type` (`src/types/index.ts:747`) | No OR composition | Allow `triggers[] OR` (legacy `trigger_type+config` kept as compat shim; validate any one fires + channel warning per trigger) | P1 |
| **Trigger channel alignment warning (will never trigger) vs error** | `isValidChannel` check errors today | Too strict | Switch to `severity: warning` when trigger channel doesn't match any downstream `channel_target` reachable | P1 |
| **Sequences as first-class domain (per-message toggle, delays, windows)** | `sequences` + `sequence_steps` + `sequence_enrollments` exist (`src/types/index.ts:767`) but builder stats noted sequence troubleshooting fragile | Exists but stats/troubleshooting not parity | Complete Sequence editor + per-message enabled toggle + wait nodes pipeline + stats stuck/not-subscribed etc. | P2 |
| **Broadcast audience + clone from automation + channel selection** | `broadcasts {audience_filter, template_*}` exists (`src/types/index.ts:421`) but no audience condition builder nor clone automation picker | Partial | Audience condition builder (tags+fields+time) + clone `Broadcast From Automation` flow (copy graph into broadcast audience) | P2 |
| **Rules (global triggers Date/Time, Tag applied/removed, Sequence sub/unsub, Field changed, New contact) → actions** | Global? Automations already have `tag_added`, `contact_changed` etc. but `Date/Time` not as cron trigger; tag via bulk vs automation distinction (`Rules ⚠️ bulk actions do NOT fire tag-applied rules`) | Partial | Add `scheduler` cron trigger (time_based) as first-class rule or global trigger; enforce `bulk ≠ automation` for tag rules flag | P2 |
| **Preview split: In Manychat (widget, limited) vs In messengers (native, full)** | `src/lib/automations/dry-run.ts` `previewAutomationSteps/previewFlowNodes` single dry-run; `src/components/automations/test-dialog.tsx` dialog | Single preview | Split dry-run `widget` (fast, limited per §18.1 table) vs `in-messengers` (full, requires login, charges disclaimer) + template manual condition & data-collection timeout in widget | P1 |
| **Analytics: per-step Starting Step Conversion Rate + Smart Delay Waiting/Passed** | `flow_run_events` exists but no computed conversion rate per step; flow `execution_count` + `last_executed_at` only | Missing | Compute `conversionRate = reachedStep / uniqueStarters` (excludes returns), smart delay `Overall/Waiting/Passed` from `automation_pending_executions` count | P2 |
| **Channel button limits channel-aware (WA 3 vs TG 10)** | Automations fixed (`validateInteractivePayload(c, telegram else whatsapp)`), Flows `send_buttons` now channel-aware (`src/lib/flows/validate.ts:370` max 10 TG else 3) but `send_list` TG still WA caps | Almost fixed; remaining list caps | Make `send_list` validation Telegram-aware (row limits TG similar to WA? + flatten vs native) | P1 (fix small) |

---

### Priority rollup (phase recommendation)

- **P0 before publishing parity claims:** Fix TG button limit inconsistency for `send_list` + `send_media` caps vs Telegram parity; verify 30-block guard not accidentally breaking templates.
- **P1 (core parity):** Message container, Action multi-task per node, Condition richer filters, Randomizer sticky persistence + 12 cap, Smart Delay window+TZ + max 365, 30-block pause guard, Start Automation sync call graph edge, multiple triggers OR, preview split, channel-mismatch warning vs error.
- **P2:** Date Smart Delay Dynamic variant, Data Collection full branching/validation, Card/Gallery, Dynamic blocks, Sequences first-class + Broadcast audience, Rules scheduler, Analytics per-step conversion.
- **P3/P4:** AI Step + AI Flow Builder Assistant (behind Pro+AI), Messenger List legacy, CAPI, Reports/version history.

---

## 28. Architectural Principle Checklist

- [ ] Did this phase **avoid** inventing Manychat restrictions not documented? — we flagged `UNCERTAIN/INFERRED` rather than error wherever Help Center silent (see §13 note "If Manychat does NOT explicitly document a restriction, say so").
- [ ] Does each field carry `VERIFIED` tier provenance? — §3 taxonomy lines include purpose/branch/wait/channel tier; §6 table lists source ID `14281196200604` etc.
- [ ] Are visual states marked inferred when screenshot not pinning palette? — Yes (§14 `UNCERTAIN` palette).
- [ ] Is Pro scope deliberately **not** claiming Enterprise/agency-only features? — Yes, we slice Pro vs Business threshold and AI add-on pricing separation (§21) and restrict parity claim to Pro without Enterprise extras (see §20 final).
- [ ] Was Graphify actually consulted before Manychat research to avoid token waste and to anchor Convox gaps to real code? — Yes: `graphify-out/graph.json` 3651 nodes queried for `automation architecture`, `flows/engine`, `validate*`, `provider`, etc., plus `docs/research/manychat-model.md` + `docs/specs/node-system.md` referenced per card; file paths included as `file_path:line_number`.

---

## References (official Manychat + reliable current sources crawled 2026-08-31–2026-09-02)

- Help Center `14281166306332` How to build a Manychat automation (2025-12-03)
- Help Center `36000105060` Flow Builder
- Help Center `14281196200604` Content Block types (2026-03-19 17:08)
- Help Center `14281167455388` Media guidelines for Facebook Messenger, WhatsApp, and Instagram automations
- Help Center `14281167138588` Data Collection block and Custom User Fields
- Help Center `14281142518556` Condition Block (2026-08-12)
- Help Center `14281151100060` Randomizer (2025-11-27) (+ `36000080590` legacy + community `9481` 12-path update 2026-04-07)
- Help Center `14281197046812` Smart Delay (2025-12-03 13:17) + legacy `36000068629`
- Help Center `14281157602716` Start another automation
- Help Center `14281198254620` How to preview automations in Manychat
- Help Center `14281111044124` Automation tab Overview
- Help Center `14281211785884` How to use Keywords Trigger (Free limit 3; 10 per rule; priority)
- Help Center `14281202572316` Setting up Manychat Sequences
- Help Center `14281228205212` Broadcasting (clone from automation, scheduling)
- Help Center `14281170185628` How to set custom rules with Triggers, Conditions, and Actions (Rules triggers + multiple OR)
- Help Center `17636378650268` Actions (category catalog, Free vs paid)
- Help Center `14281268533788` Dev Tools: Dynamic block + `14281285374364` External request + `manychat.github.io/dynamic_block_docs` + `26673580447900` Response Reference (Instagram/WhatsApp/Telegram)
- Help Center `14281187288860` Manychat AI Step (2026-07-31) + `14281200017948` AI Flow Builder assistant + `14281227789468` Power up with Manychat AI + `manychat.com/product/ai`
- Help Center `25800228332572` Pro plan (new pricing 2026-03-02: $29 Pro, 2,500 contacts, 3 channels, AI add-on $29)
- `manychat.com/pricing` (live crawl confirms $29 Pro)
- `creatorlanehq.com/blog/manychat-pricing-explained-2026` (AI not bundled — $29 add-on)
- `setsmart.io/blog/manychat-automation` + `community.manychat.com` comment `4328` Smart Delay window examples

Internal (Graphify + repo):

- `docs/specs/node-system.md:1` ConvoxOS Node System Behavioral Contracts (2026-08-31)
- `docs/research/builder-ux-model.md:1` Builder UX Interaction Model (synth ManyChat+HighLevel)
- `docs/research/architectural-gap.md` / `docs/research/gap-matrices.md` / `docs/CHANNEL_ARCHITECTURE.md:1`
- `src/lib/flows/types.ts:30` FlowNodeConfig union + `src/types/index.ts:736` Automation + steps
- `src/lib/flows/engine.ts:1` + `src/lib/automations/engine.ts:1` + `src/lib/flows/validate.ts:1` + `src/lib/automations/validate.ts:1` + `src/components/flows/flow-canvas.tsx:1` + `src/components/automations/automation-builder.tsx:1`

---

---

## 29. Verification Report (2026-09-02 — final pass, Graphify re-query + live doc re-fetch)

> **Method:** Re-queried `graphify-out/graph.json` (BFS `flows engine validate`, `automations engine triggers`, `unified-taxonomy`, `node-system.md`) without dumping large files; re-fetched Help Center `14281196200604`, `14281151100060`, `14281197046812`, `14281157602716` + cross-checked `src/lib/flows/types.ts:30`, `src/lib/flows/validate.ts:29`, `docs/specs/node-system.md:1`, `docs/research/builder-ux-model.md:1`. No application code/migration/commit made.

### VERIFIED — confirmed without change

1. **Node taxonomy top-level (6 + AI+DataCollection):** Message (container), Action (multi-task), Condition, Randomizer, Smart Delay, Start Automation = `VERIFIED` via `14281166306332` + `36000105060` instrument bar. Each listed block matches Help Center flow. Action multi-task `Each Actions step can include multiple tasks` verbatim `VERIFIED`.
2. **Nested Message content blocks (12):** `14281196200604` lists exactly Text/Image/Delay/Data Collection/File/Audio/Video/PDF/Gallery/Card/Messenger List/Dynamic — spec table matches 1:1. Channel allowlist per table (IG/Messenger/TikTok/Telegram/SMS) matches re-fetch verbatim.
3. **Action catalog:** `17636378650268` categories Recently used/Contact data/Automation/Inbox/Ads Optimization/Integrations + every enumerated task maps 1:1 to fetched Actions page (Add/Remove Tag, Set/Clear User Field, Delete Contact, Set Channel Opt-in/out, Set Bot Field, Subscribe/Unsubscribe Sequence, Make External Request, Change Menu, Log Conversion, Mark Open/Closed, Assign, Notify Assignees CAPI). `VERIFIED`.
4. **Graph branching rules:** Condition 2 outputs matching vs not, Randomizer 2–6→12 with % sliders, Smart Delay single `Choose Next Step`, Start Automation single `next after return` + implicit call + `will send all messages before returning, will not pause to wait for button/quick reply` `VERIFIED` via `14281157602716` ⚠️ note. Pause semantics `30 blocks without a pause → pause automatically` `VERIFIED` via Flow Builder doc.
5. **Channel behavior core:** builder shows only channel-supported blocks (`VERIFIED` `14281196200604` + `14281166306332` "choose the message block that corresponds to channel"), mismatch `will never trigger` is `VERIFIED` warning not hard error, WhatsApp `Text ≤3 / Telegram ≤10` button limits `VERIFIED` via `14281157003292` tier (not in Content Block types page but documented separately).
6. **Runtime Smart Delay stats + deliverability:** `Overall/Waiting/Passed` + `Smart Delay does NOT reopen 24h window` with per-channel workaround `VERIFIED` via `14281197046812` re-fetch. Randomizer sticky vs `Random path every time` batch quirk `VERIFIED` via `14281151100060` re-fetch. Preview `In Manychat` vs `In messengers` limitations table `VERIFIED` via `14281198254620`.
7. **Pro scope pricing:** Pro $29/mo 2,500 contacts + AI Step extra $29 add-on `VERIFIED` via `25800228332572` + `manychat.com/product/ai` "*AI only available as add-on to Manychat Pro*" (earlier live crawl). `Some actions not available on Free plan` `VERIFIED` via `17636378650268` header.

### CORRECTED — spec updated this pass

1. **Image/Data Collection/SMS row question marks removed:** SMS `Text, Image, Data collection` was speculative `✓?` in spec draft. Re-fetch confirms `VERIFIED` plain ✓ for SMS Image and ✓ for Data Collection; SMS Delay `VERIFIED` absent (only Text/Image/Data collection listed). Spec table §6 now corrected to plain values with `VERIFIED` citations.
2. **Card/Gallery/PDF rows clarified:** Card/Gallery `VERIFIED` absent on Telegram (allowed set lists `Text/Image/Delay/DataColl/Audio/Video/Dynamic/File` — no Card/Gallery). PDF `VERIFIED` only on Instagram (not Messenger/TG) — spec rows now plain ✗ with citation, no longer `?`/`INFERRED`.
3. **Trigger first-block taxonomy:** Draft matrix showed Trigger→Randomizer/Smart Delay/Start Automation as plain ✓ `VERIFIED`. Help Center quote only verifies `_could be a message, action, or condition_` as first block. Corrected to `✓ INFERRED` for Randomizer/SmartDelay/StartAuto and kept `✓ VERIFIED` only for Message/Action/Condition (`§13.1` row updated).
4. **Smart Delay window validation source:** Draft cited `36000068629` support article as `VERIFIED`. Current `14281197046812` documents window UI but not the `left < right → cannot publish` sentence. Corrected in `§10.2` and `§17.2` to `OBSERVED` via legacy `36000068629` (pre-Help Center), not `VERIFIED` primary, with note to treat as `OBSERVED`.

### UNCERTAIN — retained as explicitly uncertain (no silent promotion)

- Randomizer ceiling 6 vs 12 (Help Center still reads 6; community product update `9481` claims 12). Spec retains `2–6 (now up to 12 per community 2026-04-07, OBSERVED until Help Center updates)` and `§25` unknown #3.
- Button `reply_id` generation scope (per node vs per flow auto-generated) and duplicate cross-message scope — `UNCERTAIN`.
- Start Automation recursion/self-loop guard at publish — `NOT DOCUMENTED` → `UNCERTAIN` (spec `§17.2` keeps).
- Node visual palette/iconography (channel-colored rect, green check) — `INFERRED/UNCERTAIN` retained in `§14`.
- AI Step completion branching shape (single `next` vs per-goal handles) and failure/handoff branch — `UNCERTAIN` retained in `§12`.
- Same-keyword collision across automations (oldest-wins for IG Comments is `VERIFIED`, for keyword collisions across automations is `INFERRED/UNCERTAIN`).
- Condition `empty/null` semantics for `present/absent` vs `equals ""` — `NOT DOCUMENTED` retained.

### MISSING — acknowledged gaps that materially affect implementation if omitted

- No Convox `Message` container holding multiple content blocks in one graph node (today flattened `send_message/send_buttons/send_list/send_media` at `src/lib/flows/types.ts:30`) — flagged `P1` in parity matrix.
- No `Action` multi-task container (today single-purpose nodes; `src/lib/flows/types.ts:183` `SetTagNodeConfig` etc.) — `P1`.
- No Smart Delay `continue-between + day filter + contact TZ + admin-pause extension` + `Date` Dynamic offset (`src/lib/flows/types.ts:190` Wait only `amount/unit/until`) — `P1/P2`.
- No persisted Randomizer sticky bucket (`mode` field exists but no `contact_randomizer_bucket` table) — `P1`.
- No 30-block-without-pause runtime auto-pause — `P1`.
- No graph-level Start Automation callee edge with sync flush + skip-button-wait semantics (`docs/specs/node-system.md:361` notes not yet graph-level) — `P1`.
- No multiple-triggers OR per automation (`src/lib/flows/types.ts:269` single `trigger_type`) — `P1`.
- No `In Manychat` vs `In messengers` preview split (`src/lib/automations/dry-run.ts:1` single dry-run) — `P1`.
- SMS `Image` limit specs (5 MB per WhatsApp/IG vs 8 MB Messenger vs `INFERRED` SMS) — minor but needed for media validators.
- Per-step `Starting Step Conversion Rate` analytics (`flow_run_events` exists but metric not computed) — `P2`.

### CONVOX IMPLICATIONS — no spec behavior was invented that would block Convox

- Spec invents **no** unsupported `A cannot connect to B` rule. `§13.1` matrix is default-allow; all `✗` cells are only `→ Trigger` (envelope not target) and content-block-inside-Message confinement, both `VERIFIED`. All other pairs are `✓` or explicitly `UNCERTAIN/INFERRED` with note "If Manychat does NOT explicitly document a restriction, say so" — honored.
- Channel incompatibilities are **warnings** where Manychat warns (`will never trigger`) and **errors** only where Manychat publish-blocks (missing required field, duplicate `reply_id`, `sum !=100`). Spec's `§17.2` table reflects that split; Convox `src/lib/flows/validate.ts:29` severity `error|warning` already supports it — only gap is flipping channel-mismatch from error to warning and relaxing `Smart Delay window` from missing to `OBSERVED` error.
- All inferred behaviors are labeled tier (`INFERRED/OBSERVED/UNCERTAIN`) and do not silently become `MUST MATCH` requirements. `§26` principle `MUST/SHOULD/DON'T COPY` carries forward: channel-aware authoring + pause semantics + sticky bucket are `MUST`, container consolidation is `SHOULD` (refactor cost vs UX gain), Messenger List is `DON'T COPY` until demanded.
- No implementation drift: Graphify re-query confirms `src/lib/flows/types.ts:30` FlowNodeConfig union, `src/types/index.ts:482` AutomationTriggerType, `src/lib/flows/validate.ts:52` trigger/graph/Meta limit categories, `unified-taxonomy.ts:31` categories, `docs/specs/node-system.md:13` TRIGGERS envelope — all aligned with spec's `Convox equivalent` column `§26.2`.

---

*Created by research pass 2026-09-02 per task `docs/research/MANYCHAT_PRO_FLOW_BUILDER_SPEC.md`. Verification pass 2026-09-02 applied corrections above. Do NOT implement gaps without explicit next-phase instruction. Await implementation-phase approval.*
