# ConvoxOS Reconstruction Audit — ManyChat Pro + HighLevel Workflow

**Date:** 2026-08-31 · **HEAD:** `752583e` (main, ahead of `origin/main 293ecb4`) · **Scope:** Read-only research + repo audit + target contracts · **No src/migrations/commits changed in this phase**
**Research docs:** `manychat-model.md`, `highlevel-model.md`, `builder-ux-model.md`, `channel-behavior.md`, `repo-audit.md`, `gap-matrices.md`, `architectural-gap.md`
**Specs:** `docs/specs/automation-product-spec.md`, `builder-spec.md`, `node-system.md`, `channel-capabilities.md`, `crm-automation.md`
**Updates:** `ROADMAP.md` Audit Checkpoint + `docs/CHANNEL_ARCHITECTURE.md` + `PROGRESS.md`

---

## 1. Executive Verdict

**What ConvoxOS is today (VERIFIED `repo-audit.md`):** Forkable WhatsApp-native CRM with Telegram as a complete thin-plug (inbound normalize → `messages.channel` provenance → unified contact `telegram_user_id` nullable → manual text+media+inline keyboard outbound via `ChannelSocket`), channel-aware inbox (`Reply via` local, WA 24h isolated), account tenancy `is_account_member`, pipelines/deals `021`, two separate but `ChannelSocket`-shared automation planes: **Flows** (10 node types; `flow_runs` state machine suspending at buttons/list/collect_input/wait) + **Automations** (12 step types branching via parent_step_id). Flows: `flow_runs.trigger_channel` snapshot + `channel_target current|WA|TG` per send node + channel-aware resume (scan all active, filter by `trigger_channel+replyId`) + per-flow uniqueness `UNIQUE(account,contact,flow_id)` allowing TG Flow A + WA Flow B both waiting. Pending waits unified in `automation_pending_executions` (Flow `flow_run_id` reuse via `045`). Validation before activation, unreachable warnings, optimistic `current_node_key` concurrency, `meta_message_id` dedup. Tests 96 files/967 at checkpoint.

**What we are trying to become (target):** Serious CRM with *ManyChat Pro-level conversational automation* (Flow Builder visual semantics, channel-aware blocks, Data Collection, Condition all/any, Randomizer, Smart Delay windows+dates, Start Automation reuse, Sequences, Broadcasts audience frozen at send, preview In-Manychat vs In-messengers, 30-block auto-pause) **+** *HighLevel-level workflow automation* (80+ triggers across Contact/Conversation/Appointment/Opportunity etc., CRM writes Tasks/Notes/Opportunities/Pipeline moves, trigger-dependent webhook payload, If/Else + Wait + Goal + Split, Draft vs Publish independent, Stats View Attempted/Matched/Unmatched + Version History, infinite canvas with switcher). One Automation layer channel-neutral at graph but channel-aware at authoring, CRM-native.

**Biggest gap:** **P0 correctness bug before any P1 parity can be claimed:** `send_buttons/send_list` TG builds with 4–10 buttons are rejected at publish because builder validates against WA `INTERACTIVE_LIMITS.maxButtons=3` (`src/lib/whatsapp/interactive.ts:136`, `src/lib/flows/validate.ts:362`, `src/lib/automations/validate.ts:76`) without branching on `channel_target` → channel-aware capability gate missing. `ChannelSocket` routing (`src/lib/channels/socket.ts:177` reuse `dispatchText` with inline keyboard + `src/lib/channels/telegram/keyboard.ts:44` 8×8/64 validation + `src/lib/channels/telegram/send.ts:44`) is **correct** — validator/payload shape is wrong. After that, **P1 trigger catalog thin (8 vs 80+)** and **CRM `tasks` entity missing** block true HighLevel parity (cannot add Task Added/Reminder/Completed triggers nor contact-less Add Task). Those three are foundational; everything else (Wait window/Date, Condition multi, Goal/Randomizer/Sequences/Broadcasts audience) follows.

---

## 2. ManyChat Pro Product Model (condensed — full `manychat-model.md`)

**Automation product:** My Automations + Basic (Default Reply/Welcome/Conversation Starters/Main Menu/Greeting per channel) + Flow Builder + Quick Automation (IG post/reel comments only) + Templates (cloned, not live-linked) + Keywords (6 rules: `is/contains/contains like/begins with/thumbs up/doesn't contain`, 10 per rule, Free 3, priority by order, AI intent optional, SMS opt-out via Twilio layer) + Sequences (per-message enabled, delays minutes|hours|days after previous or subscription, `Send between` window, enroll via button Tag/Bulk/profile, 30-min Data Collection pause inside, `Overall/Waiting/Passed+Unique` stats) + Broadcasts (scratch or clone automation, multi-channel message sequence, audience gender/tag/etc., promo needs Lists/OTN outside 24h window, Send Now vs schedule with recipient list finalized at send, ManyChat blocks untagged outside 24h) + Rules (global triggers: date/time contact TZ, Pixel conversion, Tag applied/removed, Sequence sub/unsub, User/Bot/System field changed, New contact — notice bulk tag rule blocked while bulk field rule still fires). Limit: no strict automation count cap, **30 blocks without pause → auto-pause** (execution, not validation). Organization via folders+naming+Start Automation decomposition.

**Basic vs Flow VERIFIED single canonical model:** Header toggle `Flow ↔ Basic` ("switching back and forth allows you to choose the most suitable view"), FAQ confirm, linear message-by-message vs bird's-eye map — different editors, same persistence. **ConvoxOS target = same convergence** (two renderers over one per-engine graph).

**Flow Builder verified UX:** + instrument bar, auto-arrange, zoom, pan; `+New Trigger` Starting Step + channel MUST match channel of message nodes or trigger never fires (WA trigger for IG never fires); Tips: double-click→step picker, dot→drag to target, Shift multi-select/frame, Alt+drag copy, Cmd+C/V intra & cross-automation cross-account (disables if target lacks Tags/Sequences), undo/redo header+keyschan, dark dot rewire for entry.

**Core blocks (7 listed):** Message (container with multiple Content Blocks per node), Action (multi-task per block), Data Collection, Condition, Randomizer, Start Automation, Smart Delay — those plus Text/Image/Delay/File/Audio/Video/PDF/Card/Gallery/Messenger List/Dynamic per channel matrix verified:

- IG: Text/Image/Delay/Data/Audio/Video/PDF/Card/Gallery/Dynamic
- Messenger: Text/Image/Delay/Data/Audio/Video/Card/Gallery/Dynamic/File/List
- TikTok: Text/Image/Delay/Data
- **Telegram: Text/Image/Delay/Data/Audio/Video/Dynamic/File** (no Card/Gallery/PDF/List on TG)
- SMS: Text/Image/Data

**Buttons:** WA/Messenger/IG ≤3 vs TG ≤10 (per `14281157003292`), title ≤20, types filtered by connected channels + block channel (Call Number Messenger-only), each button `reply_id→next_node_key`.

**Condition `14281142518556`:** General filters (Tag, Widget/Ad/API opt-in with CTWA caveat use Tag/User Field, List available/Subscribed, Sequence, Current time w/ TZ, Segments) + System/Custom User/Bot Fields with offsets (coupon date > issuance+3d) + `Does the contact match: all/any` multi-condition; branching matching vs not matching; no-follow-up after condition breaks sequence message (VERIFIED). In `In Manychat` preview conditions manual.

**Randomizer `14281151100060`:** up to 6 variations % sliders, `Random path every time` unchecked (sticky first-group forever on re-entry) vs checked (random every time, no stats). Batch distribution skew example 1000→400/400/200 documented.

**Smart Delay `14281197046812`:** Duration (minutes/hours/days) + `Set continue time limit Continue between` + day filter, OR Date Specific/Dynamic (Custom User Field ± offset). Contact TZ → account TZ fallback; admin pause adds; **does not reopen 24h window** — after >24h need IG/Messenger Lists/OTN or WA template; TG no limitation. Stats Overall/Waiting/Passed + Total+Unique.

**Start Automation `14281157602716`:** Pick via `Click to Select Automation`, dot→drag continuation after. Runtime: sync inline — sends all callee messages then returns to caller without waiting for button inputs.

**Preview `14281198254620`:** `In Manychat` smartphone widget inside builder (no login) limited: no contact/third-party data (Tag manually), no Dynamic/Google/Zapier, only current automation, **no Actions/Smart Delay/Start Automation display or execution**, no input validation, no SMS/Email, no Multiple Choice/not-responded; Conditions manual; `Auto-restart prompt` on modify. `In messengers` native app full (login required; SMS/email phone input; charges apply; integrates fire). Best practice: early widget then final native; tip: complex Sheets/Zapier always test native.

**AI Builder `14281200017948`:** 8-step chat (business → goals → channel IG/Messenger/WA/TG → template/intention → trigger → generate ≤30s → Use or Back To Chat). Channels IG/Messenger/WA/TG.

Sources dated 2025-12-03 to 2026-03-19.

---

## 3. HighLevel CRM Automation Model (condensed — full `highlevel-model.md`)

Mental model: **Trigger(s) OR → Actions sequential** per workflow. Multiple triggers allowed (`Getting Started 155000002288`, Walkthrough `155000001254`). Saved ≠ Published independent (red dot unsaved; Draft = no trigger; Publish = live; **waiting remains at step on draft resume** — VERIFIED). Infinite Canvas with Fit-to-Screen/Zoom/Minimap, 6-dot drag + Move here, Switcher `Shift+W`, keyboard shortcuts, + on line → action picker, integration steps locked until Connect account.

**Trigger catalog `155000002292` 2026-06-19 (14 categories, ~110 UI labels):** Contact 12 (Birthday Reminder, Contact Changed/Created/DND/Tag, Custom Date Reminder, Note Added/Changed, Task Added/Reminder/Completed, Engagement Score), Events 22 (Inbound Webhook, Scheduler, Call Details, Email Events delivered/opened/clicked/bounced/spam/unsubscribe, Customer Replied, Conversation AI, Custom Trigger, Form/Survey/TikTok Form/LinkedIn Lead Form, Video Tracking, Number Validation, SMS Error, PageView/UTM, Quiz, Review, Prospect, Click-To-WhatsApp Ads, External Tracking), Appointments 4, Opportunities 5 (Status Changed/Created/Changed, Pipeline Stage Changed, Stale), plus Affiliate/Courses/Payments/Ecommerce/IVR/FB|IG Events/Communities/Certificates/Communication/Google Ads. Plus Company-Created/Changed B2B workflows `155000006688`.

Stats: Trigger Attempted/Matched/Unmatched drill per-contact (30-day, retains after delete, editing disabled in Stats View) + per-communication delivery/engagement. Workflow-level expand stats.

Testing `155000001254`: `Test Workflow` → pick contact → Run Test entire workflow including webhook → Execution Logs `Executed` (note: same-contact reuse imperfect; publish+live ideal).

**Action catalog `155000002294` 2026-06-03 (13 categories):** Contact 15 (Create/Find/Update Field/Add|Remove Tag/Assign|Remove User/Edit Conversation/DND/Add Note/Task(copy/contact-less allowed)+Copy/Delete/Engagement Score/Followers), Communication 15 (Email/SMS/Slack/Call/Messenger/IG DM/Manual/GMB/Internal Notification/Review Request/Conversation AI/Facebook|Instagram Interactive/Reply in Comments/WhatsApp/Live Chat), Send Data 2 (Webhook/Custom Webhook, Google Sheets), Internal Tools 11 (If/Else, Wait, Goal skip-ahead, Split, Update Custom Value, Go To/Drip Mode/Arrays/Text Formatter/Custom Code/Remove from Workflow), Workflow AI (AI Prompt GPT-3), Eliza (Booking/Send to Platform), Appointments (Update Status, One-Time Booking Link), Opportunities (Create/Update, Remove), plus Payments/Marketing/Affiliate/Courses/IVR/Communities. **Webhook `155000003299` trigger-dependent:** standard contact+account data always, appointment/opportunity data only if trigger is that type; Custom Data key/value interpolates `{{contact.*}}` / `{{custom_fields.*}}`.

**CRM↔Workflow matrix (§4 full):** Contact/Conversation/Opportunity/Pipeline/Task/Note/Appointment/Assignment all read+write+triggerable per verified catalog; opportunity-aware context scoping (tag-added workflow sends only contact data) already, contact-less `Add Task` via Inbound Webhook allowed, chaining via `Add to Workflow` (+ `Pass Input Trigger Parameters` passes original trigger fields — receiving workflow needs no own trigger; custom-code outputs NOT passed, must via Contact field) and `Go To`, `Remove from Workflow` cancels, Go-to/Goal ends/skip handling. Fix outlines, B1-Greply.

Standpure.

---

## 4. Builder UX / Interaction Model (synthesis — full `builder-ux-model.md`)

**Canvas:** ConvoxOS existing `@xyflow/react` in Flows is target parity (HighLevel infinite+minimap+fit already). Automations builder (`builder-tree` sequential+branch) needs minimap+fit+zoom. Add 6-dot handle uniformity + `Move here` indicator.

**Node lifecycle:** `+` nor double-click empty→picker, drop at cursor, store pos xy/flow or position/parent_step_id/branch automation. Shift multi-select frame, Alt+drag clone, Cmd+C/V intra & cross-automation with sanitized `node_key` suffix copy + rewrite internal edges within selection; cross-automation deps disabled like ManyChat ("some actions may be disabled if target lacks Tags/Sequences"). Selection→side sheet config form filtered by `authoringChannel`.

**Validation states** `validateFlowForActivation:57` `error|warning` with `scope flow|trigger|node + node_key + field` map to visual red/yellow/blue on node + highlight → jump.

**Connections:** derive via `edges.ts:40` already — require cycle guard DFA? O.

**Preview contract:** Add `In-Canvas` widget for text/image/buttons/delay/card/gallery limited ([Manychat verification] GHI++

**Testing/pathing:** ...

**Analytics inline:** Mant.

(abbreviated; full contract in `builder-spec.md` + `builder-ux-model.md`)

---

## 5. Node System (summary — full `docs/specs/node-system.md`)

25-field cards per node grounded on `unified-taxonomy.ts:31` categories communication|input|logic|timing|crm|integration|control.

| Node | Card owner | Gap |
|------|------------|-----|
| Trigger | channel-aware Any|WA|TG filter, 8→80+ catalog, multi-OR P2 | P1 expand |
| Send Message | text+`channel_target current|WA|TG` per resolver snapshot legacy null→WA, current→snapshot else error never silent `engine.ts:175,222` | — |
| Buttons | WA≤3 TG≤10 per matrix Title≤20 `reply_id→callback_data`映射 flatten; P0 cap fix | P0 |
| List | 10 rows total, row Title≤24 Desc≤72, TG flat→keyboard | P0 same |
| Media | WA image|video|document|audio TG +voice per `socket.ts:143` mapping | promote to both hosts P1 |
| Template | WA-only locked `Templates are only supported for WhatsApp` `engine.ts:461` | — |
| Delay inside message | typing pill `Delay` content block (not wait) hidden TG indicator | P2 |
| Collect Input | Flows-only today `prompt_text+var_key+next+channel_target` suspend→capture vars (captured_length only) `engine.ts:798,1207`; validation ignored forward-compat; 30m timeout branch missing | P2 |
| Condition | Flows var|tag|contact_field + Automation tag_presence|contact_field|message_content|time_of_day; target unify+AND/OR multi `all/any` | P1 |
| Randomizer | 2–6 % sticky/every | new P2 |
| Wait | fixed duration only → Duration Date with Continue-between + day+T Z+offset target | P1 |
| Goal | skip-ahead | new P2 |
| Tag | set_tag/add_tag depth guard `MAX_TAG_CHAIN_DEPTH` `tag-chain.ts:1` | multi-action per block P3 |
| Update Contact | `custom:<id>` guard scoped `eq(account_id)` `engine.ts:578` built-ins name/email/company | clear/delete P3 |
| Create Deal | currency default `deals.currency` fallback `engine.ts:621` create only | update/move P1 |
| Assign/Handoff/Close | assign `mode specific|round_robin` placeholder `engine.ts:548` ; handoff →pending `engine.ts:575` | remove/nfy P3 |
| Webhook/HTTP | POST `isDeliverableUrl`+10s+manual redir `engine.ts:649` | GET/PUT/DELETE+fallback P2 |
| End | terminal | align Automation P2 |

Add nodes still visuals?

---

## 6. Channel Model (full `channel-capabilities.md`)

Channel-neutral automation + channel-aware authoring — verified both products (ManyChat "choose block corresponds to channel… optimized", HighLevel channel actions per comm category).

**Matrix WA vs TG (implemented scope)** nine rows shown — WA: Text/Image/Video/Doc/Audio (voice→audio) Button≤3 List≤10 Template required 24h window, TG: Text4096/Image/Video/Doc/Audio/voice File Button≤10 List via keyboard Inline keyboard 8×8/64 callback 1–64B no 24h. Intense IG/Messenger/SMS/Email table research-only future plugs matrix shipped in that doc.

**Targeting contracts** already `trigger_config.channel any|WA|TG` via `triggerChannelMatches:190` (any/pass, specific must equal, non-conv trigger passes flow but fails-closed automation keyword/interactive `engine.ts:766` prevents silent fire). Per-node `channel_target current|WA|TG` via `resolveChannelTarget` legacy null→WA, current→snapshot else `null→channel_target_missing` deterministic never silent WA default — builder requires channel at publish (`validate.ts:62`, `flows/validate.ts:248`). `Current` without conversational context (tag/time trigger) error `Current requires inbound channel — choose … explicitly`.

Socket `socket.ts:65/110/177` thin explicit branches to `whatsapp/send-message` vs `telegram/send*` + normalized `ChannelSocketError` codes (target_identity_missing, channel_disconnected, capability_not_supported, unsupported_channel).

**Builder hiding** per `channel-capabilities.md` §6: Hide (gallery on WA/TG), Disable (plan-gated), Warning (channel mismatch never trigger), Error (missing target / cap), Transform WA→TG inline_keyboard documented.

**Add-channel steps** 8 canonical: `*_config` encrypted table, `contacts.<provider>_user_id` identity UNIQUE, `messages.channel` CHECK migration, extend `ChannelTarget` unions, `normalize+send` module, webhook, `availableChannels`+Reply via, matrix doc. No `channels` table.

---

## 7. CRM ↔ Automation Model (full `crm-automation.md`)

| Entity | Table | Current | Target |
|--------|-------|---------|--------|
| Contact | `contacts` phone nullable + tg ids (`041`) | Keep; add DND P3 | P3 |
| Conversation | `conversations UNIQUE(account,contact)` open|pending|closed | Keep | — |
| Message | `messages` channel provenance | — | — |
| Tag | `tags` + `contact_tags` + MAX_TAG_CHAIN_DEPTH | — | — |
| Custom field | `custom_fields` + `contact_custom_values` custom:`<id>` guard | — | — |
| Opportunity | `pipelines/stages/deals` exists | Missing update/move/remove nodes + triggers | P1 |
| Task | ❌ no table | New `tasks` P1 | P1 |
| Note | `contact_notes` exists `001` but no `add_note` node | Add Note node P1 | P1 |
| Appointment | ❌ | Optional P3 | P3 |
| Assignment | `conversations.assigned_agent_id` | Remove User Notify P3 | P3 |
| Activity | derived 5 tables | Aggregated feed P2 | P2 |
| Sequence | ❌ | New P2 | P2 |
| Broadcast | `broadcasts/recipients` template-only | Audience+channel P2 | P2 |
| AI/Knowledge | `ai_configs`/`ai_knowledge_*` | Workflow AI Prompt P3 | P3 |

Mutations matrix, opportunity vs contact field scoping (trigger-dependent webhook payload verified HighLevel §8.3), lifecycle states enrolled/running/waiting/branched/goal/completed/failed/cancelled/timed_out exposed per `automation_logs`+`flow_runs`+`pending` (see `automation-product-spec.md` §2.5), enrollment/re-entry/concurrent/multi-opportunity/stop-on-response semantics detailed in spec §2.4/4.3, account scoping via `automation_pending_executions.account_id NOT NULL` `017:288` + contacts guard `engine.ts:96`.

---

## 8. ConvoxOS Current State (actual repo — `repo-audit.md` full)

**Migrations `001`–`046`:** `001` contacts/tags/pipelines/deals/broadcasts/broadcast_recipients/message_templates, `006` automations+pending, `010` flows+flow_nodes+flow_runs+events `interactive_reply_id`, `014` template meta, `017` accounts sharing all tenancy columns + indexes, `022` phone dedupe normalized, `029/030` AI reply/knowledge, `036` conversation dedup UNIQUE, `037` `conversation_id,message_id` unique, `040` telegram_config, `041/042` channel provenance NOT NULL CHECK, `043` `flow_runs.trigger_channel`, `044` per-flow uniqueness, `045` flow wait reuse pending `flow_run_id`, `046` allow wait CHECK.

**Flows current:** 10 node types + `http_fetch` CHECK orphan, channel_target per send/collect/wait/media, engine full `resolveChannelTarget` + `triggerChannelMatches` + channel-aware resume + wait shared table + fallback `fallback.ts:1` + validate per-node caps + unreachable BFS + edges pure `edges.ts:1`.

**Automations current:** 8 triggers, 12 steps, channel filter `any|WA|TG` fails-closed on interactive/keyword (`channel.test.ts:27` 4 tests), comm channel_target `current|WA|TG`, `resolveAutomationChannelTarget`, tag chain depth, custom field `custom:<id>` account guard, deals currency fallback, placeholder round-robin, webhook SSRF+10s manual, logs pessimistic `failed` default inserted before steps, dry-run for dialog (`dry-run.ts:1`), builder-tree bugfix for nested condition `builder-tree.test.ts:1`.

**Channels:** `Channel = whatsapp|telegram` (`types.ts:11`), NormalizedInbound `channel, providerMessageId, kind, telegram* , senderPhone/Name`, `processNormalizedInbound` pipeline contact→conversation→message+bump→reopen→flagBroadcast(WA only)→flows→automations→AI→webhook (`processNormalizedInbound.ts:232,342,373`). Contacts phone nullable + tg unique, `messages.channel` default. Outbound WA `sendMessageToConversation` 24h window `session.ts:1` preserved, TG `sendTelegramText:44` Text4096 + `sendTelegramMedia` + `keyboard.ts:44` up to 64 + URL https validation + `answerCallbackQuery` best-effort. Socket thin explicit.

**Inbox:** thread `message-thread.tsx:86` `selectedChannel` local per conversation deriving `availableChannels` from phone/telegram_user_id, composer `message-composer.tsx:50` `Reply via` selector + banner Telegram not connected → channels deeplink + mixed threads both badges.

**Known bug traced (read-only):** `send_buttons` validator caps WA→TG: `validateInteractivePayload` `src/lib/whatsapp/interactive.ts:136` `maxButtons=3` called from `validateStepsForActivation:79` + flow `validate.ts:362` fixed cap → TG 4–10 valid builds rejected before reaching correct TG inline keyboard path (`flows/engine.ts:451` + `automations/engine.ts:417` + `socket.ts:177` correct). See `repo-audit.md` §6 full trace.

**Build:** Next16 App Router, React19, TypeScript, Tailwind4, shadcn, next-intl, Supabase PG17 Auth+Storage+RLS, Vitest + ESLint + Prettier, `is_account_member` RLS pattern, `@xyflow/react:@dagrejs/dagre` Flow canvas, `dnd-kit` builder, validates.

---

## 9. Feature Gap Matrix

Condensed; full matrix `docs/research/gap-matrices.md` §1 (24 rows) with sources per cell `VERIFIED` etc.

| Capability | Priority | Gap size |
|-----------|----------|----------|
| Triggers | P1 | 8→80+ |
| CRM Task entity+notes | P1 | tasks missing; notes node missing |
| Wait variants + Goal | P1/P2 | fixed vs wind/date/TZ |
| Condition multi | P1 | single→all/any |
| Media promote | P1 | flow-only |
| Buttons/Lists caps | **P0** | TG 10 vs WA3 |
| Randomizer/Goal/Sequences/Broadcasts audience | P2 | new domains |
| Templates/ Reusable Start | P2 | lite |
| Testing Preview/widget + Stats/History | P2 | lite |
| Webhook full + AI Prompt | P2/P3 | POST→full |
| IG/MM/SMS/Email channels | P4 | future CHECKs |

---

## 10. Node Gap Matrix

Condensed; full `gap-matrices.md` §2 (22 nodes):

| Node | Gap | Pri | Why |
|------|-----|-----|-----|
| Trigger | catalog thin, single not multi-OR | P1 | GHL 80+ |
| Buttons/Lists | TG cap mismatch | **P0** | validator physics |
| Collect Input | timeout+validation missing | P2 | 30m branch |
| Condition | single→multi ALL/ANY | P1 | ManyChat |
| Wait | fix→smart variants | P1 | |
| Randomizer | missing | P2 | 2–6 sticky |
| Start Automation | missing | P2 | sync |
| Task | table missing | P1 | new |
| Note | table exist node missing | P1 | node |
| Opportunity update/move | create only | P1 | pipeline |
| Goal | missing | P2 | skip-ahead |
| Sequence/Broadcast | missing/domain | P2 | manychat |
| Webhook/HTTP | POST→full | P2 | external |

---

## 11. Architectural Gap Analysis (full `architectural-gap.md`)

**Keeps (§1):** unified contacts `telegram_user_id`, `messages.channel`, `trigger_channel` snapshot, ChannelSocket thin explicit, normalized inbound fan-out ordering, pending unified table, channel-aware resume isolation, per-flow uniqueness, fallback dedup optimistic+23505, tenancy guard, unreachable BFS validation.

**Needs (§2):** channel-cap gate P0; `tasks` new table P1; notes node P1; opportunity R/W+triggers P1; trigger catalog expansion P1; wait window/date P1; condition multi P1; cycle guard P1; sequences+broadcast audience P2.

**Non-goals (§3) rebutted:** `channels` table, Conversation.channel, ChannelFactory/Registry/Sender, per-channel polymorphic config, microservices, event bus/CQRS — each explicit why not (additive CHECK migration instead of table, unified thread vs split, explicit `if telegram` branches vs factory at 2 channels, synchronous ordering breaks on bus). Justified with `stay boring` `ROADMAP.md:26` + `docs/CHANNEL_ARCHITECTURE.md:40`.

---

## 12. Product Specification Changes

New authoritative contracts (no src yet):

- `docs/specs/automation-product-spec.md` — positioning diagram, one product dual-engine, lifecycle Draft→Validate→Test→Publish→Active→Paused(preserve waiting)→Archived with edit-active semantics, enrollment/re-entry/concurrency, execution states `active|waiting|completed|handed_off|failed|timed_out|paused_by_agent|cancelled` + stats 30d, 16-trigger target catalog, node set taxonomy, Sequences/Broadcasts domain definitions, preview modes `In-Canvas` limits table, publish/version history, channel correctness no-silent-default, limits 30-block/64 iter caps, P4 boundary.

- `docs/specs/builder-spec.md` — two editors canonical convergence, infinite canvas contract, add/move/auto-arrange/copy-paste `Alt+drag`/`Cmd+C/V` sanitized, 6-dot handle+Move here, connection semantics per `edges.ts` + `builder-tree.ts`, dangling/unreachable/cycle rules, selection/side sheet/ChannelTargetRow `current|WA|TG`, Undo 50 + dirty Saved≠Published (+ red dot), validation visual mapping `error|warning|info`, preview quick vs full with contact selector + execution log, analytics inline, history snapshots, templates clone not link, switcher `Shift+W` P3, shortcuts.

- `docs/specs/node-system.md` — 25-field cards per trigger + 18 node types with visual, schema (`SendMessageNodeConfig` etc.), required/optional, inputs/outputs/branches, channel TG hidden vs disable vs transform, CRM read/write per entity, runtime advance+dispatch+suspend log, failure class+recovery, validation publish-block vs warning, testing per preview mode, execution state + snapshot, serialization edges-in-config vs parent/branch, analytics, reusability hosts `unified-taxonomy.ts:88`.

- `docs/specs/channel-capabilities.md` — canonical matrix WA/TG 13 caps + IG/MM/SMS/Email research table + limits TG 4096/1024 caps, WA 3 vs TG 10, 8×8/64, 1–64B; targeting `trigger channel any|WA|TG` + `channel_target current|WA|TG` resolver legacy null→WA else hard `channel_target_missing`, Socket thin branches, 5 authoring strategies Hide/Disable/Warning/Error/Transform, add-channel 8 steps.

- `docs/specs/crm-automation.md` — entity table `Contact/Conversation/Message/Tag/Custom/Opp/Task(❌ P1 new)/Note ⚠️ P1 node/Appointment P3/Assignment/Activity P2/...AI`, mutation/read/trigger matrix, opportunity vs contact scoping trigger-dependent payload (GHL verified), execution state surfaced per CRM facet (contact timeline, conversation pill `flow_runs` realtime, kanban, inbox assign), enrollment/re-entry/concurrent multi-opportunity/stop-on-response, tenancy pending `account_id NOT NULL`.

All specs cite `VERIFIED` URLs + exact `file:line`.

---

## 13. Implementation Roadmap — Ordered P0→P4

Priority = correctness > dependency > user value > prereq > parity > effort last. Each phase includes DoD with `typecheck + build + targeted tests + channel隔离 smoke` per repo `ci.yml` + `PROGRESS.md` working rules (never commit `.opencode/graphify-out`).

### Phase P0 — Foundation Correctness (before claiming any channel-neutral parity)

**1. TG channel-aware caps** — fix `validateFlowForActivation:362` branch per `channel_target` WA ≤3 vs TG ≤10 (+ `validateInteractivePayload:136` overload or new `validateTelegramInteractivePayload` wrapper) + `validateStepsForActivation:76` same; adjust flow `send_list` row limit similarly if TG flattened semantics differ (list row Title≤64 for TG? use TG higher but doc says 64 for button text, keep per matrix). DoD: existing WA builds still capped 3, new TG build with 6 buttons `current`+telegram trigger passes activation and TG send produces inline keyboard `validateTelegramInlineMarkup` pass; `channel.test.ts`+`validate.test.ts` updated. Depends on nothing.

### Phase P1 — Core Conversational + CRM Workflow Parity (the HighLevel/ManyChat minimum to be serious)

**2. Trigger catalog P1a (conversational)** — add `customer_replied`, `contact_created` alias, `contact_changed` (field whitelist + value guard), `inbound_webhook` route `POST /api/trigger/webhook/[id]` normalizing to `processNormalizedInbound` kind text with webhook payload, `form_submitted` stub (optional if no forms entity — queue as P2 if no). Expand `trigger_config` JSONB schema + `triggerMatches`/`triggerChannelMatches` cases. DoD: new triggers appear in `TriggerPanel` picker `any|WA|TG` where relevant + enrollment e2e.

**3. CRM entities P1b:** New migration `0XX_tasks.sql` `tasks {id, account_id, contact_id nullable, assigned_to nullable, title, status open|completed, due_at, source_workflow}` RLS `is_account_member`, indexes; expose `POST /api/tasks` already? Add `add_task` Automation/Flow node + `Task Added/Reminder/Completed` triggers wiring (for contact-less via webhook). Also add `add_note` node for `contact_notes` (table exists) + `Note Added/Changed` triggers wiring client-side. Add `update_opportunity/move_stage/remove` nodes + `Opportunity/Pipeline Stage/Stale` triggers (reuse `deals`/`pipelines` with `stage_id` filter, add `pipeline_stage_changed` filter on stage_id). Requires opportunity-aware `AutomationContext` + pending `context.opportunity_id` for webhook payload `trigger-dependent` warning.

**4. Condition multi + Wait full:** Condition → `conditions:[{subject,operator,value,subject_key}] + matchMode all|any` with engine `every` vs `some`; Wait → `type:duration|date` with `continueBetween HH:mm + days + tz + offset` then `waitMsForFlow` + builder row. DoD: builder shows Add condition + Match all/any toggle; wait builder exposes window/day/off style (like Smart Delay). Tests `condition-branch.test.ts` extended.

**5. Cycle guard** — DFS at `validateFlowForActivation` → error `Cycle detected without exit` while allowing still-rejected dangling cycle.

Depends on P0 (caps must be fixed before expanding builder complexity).

### Phase P2 — Major Parity (competitive launch block)

**6. Randomizer** 2–6 variations `sticky|every` with per-contact bucket persisted (likely `contact_*` kv or `flow_runs.vars[__randomizer::<node_key>]`) + `Split` alias `P2`.

**7. Goal skip-ahead** — wait bypass via new `goal` node + global listener check in `processNormalizedInbound` before resume (as spec §7).

**8. Sequences domain** — new `sequences`, `sequence_messages`, `contact_sequences` enrollment table + `Subscribe/Unsubscribe` actions + per-message enabled+delays+window.

**9. Broadcasts audience+channel** — add `audience_filter` builder UI + channel selection `WA|TG|Any` + schedule frozen-at-send refinement (already send locking).

**10. External Request full** — `Method GET|POST|PUT|DELETE` + headers template + fallback branch `on_error_next` + `Settings→Logs` view.

**11. Stats View + Version History + Testing polish** — `Attempted/Matched/Unmatched` per trigger 30-day drill + per-node Waiting/Passed + per-communication delivery ; `flows_history` snapshot on save `GET/PUT` + `History` icon; quick preview widget + Flows `dry-run` + contact selector full test.

**12. Reusable automation** — `Start Automation` inline sync call node (caller waits for callee messages then resumes without input) + `Add to Workflow` trigger chain UI.

Depends on P1 (tasks/opportunity payload needed for goal branching).

### Phase P3 — Valuable (polish after launch)

**13.** Delete contact/DND opt, Notify assignees, Google Sheets marketplace spike, Workflow AI Prompt action (GPT-3 text transform), Appointment entity if calendar product owned, Workflow AI assistant suggestions command palette, Inbox typing indicator chore.

### Phase P4 — Later (enterprise/future channels)

**14.** Instagram `instagram_config` clone TG plug steps 8 (`docs/specs/channel-capabilities.md` §5 + `CHANNEL_ARCHITECTURE.md` style) → then Messenger → SMS/Email (each adds `messages.channel` CHECK value + socket branch). Plus Company workflows, Ecommerce/IVR/Courses, bulk analytics, microservices/event bus (explicitly not justified until 4+ channels with identical quirks).

---

## 14. Risks / Edge Cases

| Area | Risk | Why it matters | Mitigation (contract already) |
|------|------|----------------|------------------------------|
| **Channel mismatch** | TG 10-button build validated as WA 3 → publish blocks valid TG; or silent WA default leaks | Channel correctness is correctness | P0 per-target validate; `current→hard error` never silent WA default |
| **TG payload transform** | WA `InteractiveButton {id,title}` stored → TG needs `inline_keyboard {text,callback_data}` per branch; description ignored | ManyChat seam: TG text 10 vs WA 3 | Mapping `buttons.map({text:title, callback_data:id})` + list flatMap already correct — validate against TG cap separately |
| **Invalid dangling/unreachable/cycle** | Editing delete leaves phantom edge; unreachable wasted; loop overflows 64 cap `engine.ts:694` with `advance_loop_safety_break` state `failed` | Determinism | BFS unreachable warning + DFS cycle error + `unlinkNodeReferences:333` clears on delete |
| **Wait + 24h window** | Smart Delay >24h WA regular message blocked; TG not; ManyChat caveat at scale `docs/research/channel-behavior.md` | Deliverability | Use Template after Wait on WA path; builder hint `this will exceed window — switch to Template` when wait+sends span >24h on WA |
| **Contact TZ** | Wait `Continue between` on contact TZ unknown fallback | Offset drift | Contact TZ if known else account TZ — ManyChat VERIFIED; ConvoxOS pending `continueBetween` must carry fallback |
| **Wait editing mid-flight** | Active waiting pending row has captured `run_at`+`next_node_key+vars+trigger_channel`; editing automation's wait duration does not retro-change enqueued row — new enrollments only (GHL VERIFIED waiting preserved) | Version semantics | Pending snapshot docs current; document in publish UI `existing waiting contacts will keep old timing` |
| **Re-entry duplicate enrollment** | Same keyword/tag fires same automation repeatedly → duplicate logs; GHL no auto-dedupe (user must guard via tag) | Spam | Recommend `tag already present → skip` guard pattern; long‑term P2 optional `Re-entry: Once per day` toggle (not P1) |
| **Concurrent runs** | Flow per-flow limit (44) vs Automation per-runtime log concurrency — multiple pending for same contact co‑exist, resume orders by `started_at desc` + channel+reply exact isolation `resume-channel.test.ts` | Double-send | Keep isolation; add warning if ambiguous resume (multiple runs match) `engine.ts:1095` warn and continue first |
| **Multiple opportunities** | One contact many deals; trigger/context not scoped → which deal to update/move? | CRM ambiguity | Carry `opportunity_id` in trigger context for opportunity triggers; generic tag trigger carries none — `send_webhook` trigger-dependent payload warning |
| **CRM mutation race during run** | Tag add fires `tag_added` chains while outer wait still pending; depth guard `MAX_TAG_CHAIN_DEPTH` prevents loop only to that depth | Loop bound | Keep depth guard `engine.ts:506` warn+skip |
| **Editing active automation branch** | Changing `true_next/false_next` while contacts waiting at that condition not yet evaluated — next evaluation uses new branch; waiting at condition not existent (condition never waits). For waits: next already captured | Consistency | Pending `next_node_key` is snapshot — branch edits do not affect already-enqueued waits |
| **Provider failure** | Meta 4xx vs TG error shape `SendTelegramError`→ `ChannelSocketError`; `target_identity_missing` vs `channel_disconnected` | Observability | Socket normalizes (`socket.ts:18,88,127,144`) codes mapped; no retry in runner — manual re-publish / re-send path; waiting stays waiting? no, failure fails run `send_text_failed` not requeued |
| **Retry / partial** | Wait enqueue failed → run failed `wait_enqueue_failed` not pending | Durability | Retry is manual — re‑trigger by resending inbound; no cron auto‑retry for enqueue failure |
| **Goal skip interaction** | Goal event arrival while contacts waiting across multiple pending runs — which jumps? | Determinism | Goal listener must match specific run’s goal criteria + account+contact scope |
| **Reusable nested recursion** | `Start Automation A → Start B → Start A` recursion visible loops blocked but non‑visible loops still possible (GHL warning) | Infinite loop | Depth counter same as tag chain (existing) — add `MAX_AUTOMATION_NEST_DEPTH` guard P2 |
| **Concurrency + idempotency** | Webhook retry `meta_message_id` duplicate inbound replay `processNormalizedInbound` `ON CONFLICT ignoreDuplicates` + flow `isDuplicateInbound:351` + optimistic `current_node_key` | Double advance | Rely on three layers already |

---

## 15. What We Should NOT Build Yet

Explicit P4 boundary — impressive but foundation would break:

- **Multi‑channel beyond WA+TG before P0–P1 proven — no Instagram/Messenger/SMS/Email now** — each adds `messages.channel` CHECK migration + per-provider `*_config` table + identity column + socket branch; scope creep with no product signal.
- **Full AI Builder (ManyChat 8‑step chat / GHL command palette text transforms beyond prompt)** — ConvoxOS knowledge `ai_knowledge_*` already, workflow AI action too early before trigger+C RM parity.
- **Excessive analytics** — beyond trigger Attempted/Matched/Unmatched + per‑node Waiting/Passed + broadcast delivered/read; no funnel cohort/dwell dashboards before execution correctness.
- **Excessive integrations beyond webhook** — Google Sheets/Todoist/Slack marketplace actions gated behind P3; no generic Zapier router.
- **Microservices / Event bus / CQRS / generic ChannelRegistry/factory/plugin marketplace** — rebutted in `architectural-gap.md` §3 : synchronous ordered fan‑out (`processNormalizedInbound:232`) would break on bus; 233‑line Socket proves factory adds indirection before 4 channels; scope not at 10x scale with separate teams.

Each deferred item remains documented as P4 in ROADMAP Audit Checkpoint.

---

## 16. Final Target Architecture

**CRM ↔ Automation ↔ Conversation ↔ Channels ↔ AI ↔ Knowledge — how builder nodes interact** (consistent with `docs/CHANNEL_ARCHITECTURE.md:18` diagram style):

```
                       CONVOXOS CRM
                       ============
  Accounts (tenancy) — Profiles/Roles — is_account_member RLS
  Contacts (phone nullable + telegram_user_id unique + instagram/mess. future)
  Custom Fields + contact_custom_values (custom:<id>)
  Contact Notes — Tasks (P1 new) — Pipelines/Stages/Deals (currency, stage move)
  Broadcasts/Recipients — Sequences (P2) — Activities feed (derived)

                              ↕  RLS + service-role guards

                        AUTOMATION LAYER
                        ================
          ┌───────────────────────┬──────────────────────┐
          ↓                       ↓                      ↓
     Flows (conversational)   Automations (CRM)    Pending Queue
     `flows` + `flow_nodes`   `automations` +      `automation_pending_executions`
     per graph (node_key,     `automation_steps`   {account_id, flow_run_id? /
     edges‑in‑config)         (parent/branch)       automation_id? + contact, log,
                                                   next*, vars, trigger_channel, run_at}
            ↕                       ↕                      ↕ (cron resume)
            └──────────┬────────────┘─────────────────────┘
                       ↓
              ChannelSocket (thin, explicit — no factory)
              dispatchText / dispatchMedia / dispatchInteractive
              resolveChannelTarget(current→snapshot else explicit)
              ChannelSocketError normalized (missing/disconnected/unsupported)

                              ↕

                     CONVERSATION HOST
                     ================
  Unified `conversations UNIQUE(account,contact)` — no Conversation.channel
  `messages.channel whatsapp|telegram (future ig/ms)` provenance
  per‑message provenance  — thread derives Reply via / filter All|WA|TG
  bump_on_inbound + reopenClosed + flagBroadcastReply WA‑only

                              ↕

                   CHANNEL PLUGS / CORE
                   ===================
  WhatsApp native core — whatsapp_config + session 24h + templates/meta-api + flow-media
                     ║
                 Channel Socket boundary
                     ║
            ┌────────┴────────┐
            ↓                 ↓
       Telegram plug     Future plug(s) via same 8 steps:
       telegram_config   *_config + contacts.<id> + messages CHECK + normalize→NormalizedInbound
       normalize→type    + webhook + send* + panel + socket branch
       send(+media+kb)
       answerCallback
       chat-media/tg/

                              ↕  `processNormalizedInbound` → `dispatchInboundToFlows`
                              ↕                           + `runAutomationsForTrigger`
                              ↕                           + `dispatchInboundToAiReply`

                         AI / KNOWLEDGE
                         ============
  ai_configs + ai_knowledge_documents/chunks (semantic + FTS) → auto‑reply fan‑out
  `is_account_member` scoped, AI Prompt workflow action (P3) attaches here
```

**Node → CRM → Channel flow, example:**

```
Trigger: Pipeline Stage Changed (Opportunity P1 trigger, pipeline=Sales, stage=Demo Done, channel any)
  ↓ enrollment (account guard 96) creates automation_log status=failed pessimistic
Condition: Contact field email present?  branch true
  ↓ yes → Send Telegram (channel_target=telegram) checks channel identity target_identity_missing?
         → ChannelSocket.dispatchText → sendTelegramText inlineKeyboard? none → persist messages.channel=telegram
         → log message_sent {channel, providerMessageId}
Wait: 2 hours (Pending queue run_at=now+7200, snapshot trigger_channel null here so Current downstream must be explicit)
  ↓ cron resume → next
Create Deal? No — Update Opportunity move to Closing (P1) scoped to carried opportunity_id
  ↓ Webhook POST (URL+headers+body with opportunity/vars) manual redirect, 10s timeout → log success {webhook 200}
Add Note: "Moved after stage automation" → contact_notes insert
→ finalize log success, increment counter RPC
```

Each edge is explicit: CRM mutations always `eq(account_id, …)` scoped even through service‑role; channel decisions always via `channel_target` resolver not silent WA; waiting durable in PG not memory; builder hides unsupported caps per `channel-capabilities.md` matrix so publish cannot carry TG violation hidden as WA valid.

**Verification refs:** Channel cuts at `src/lib/channels/socket.ts:1`, inbound fan‑out `src/lib/inbound/processNormalizedInbound.ts:232`, flows advance `src/lib/flows/engine.ts:684` 64‑safe loop, automations `src/lib/automations/engine.ts:262` branch recursion with appendResults, migrations PG17 replay `supabase db reset --local` per `ROADMAP.md`, Graphify 3131 nodes.

---

### Evidence & Audit Trail

- Official ManyChat: `help.manychat.com` articles dated 2025-12-03 → 2026-03-19 listed in `manychat-model.md` header (14 fetches live‑crawl preferred).
- HighLevel: `help.gohighlevel.com` `155000002292` 2026‑06‑19 triggers full list, `155000002294` 2026‑06‑03 actions complete list, walkthrough `155000001254` 2026‑07‑24, webhook `155000003299`.
- Repo: file:line citations per `repo-audit.md` — flows `010_flows.sql:137` UNIQUE, trigger channel `043`, uniqueness `044`, pending `045`, interactive `src/lib/whatsapp/interactive.ts:112`, keyboard `src/lib/channels/telegram/keyboard.ts:44`, socket `src/lib/channels/socket.ts:65/110/177`, inbound `processNormalizedInbound.ts:232/342/373`.
- Uncertainties marked UNCERTAIN in source models (e.g., ManyChat minimap, Broadcast recipient frozen at send for tag growth verified but TG File→Doc mapping UNCERTAIN at edge).
- **No destructive actions** — all recommendations additive; spec change set limited to docs enumerated.

*Implementers — start at §13 P0; each spec is blueprint without re‑discovering product behavior.*
