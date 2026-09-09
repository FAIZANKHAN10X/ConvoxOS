# Manychat → Convox Automation Architecture & Implementation Plan

> **Status:** Planning only — no code. Verified spec `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md:1` is source of truth.
> **Framing correction (this doc):** Manychat is the target product reference for *all* automation UX + capability. Existing Convox architecture is starting point, not constraint. Visual + functional parity both matter. Clean unified architecture preferred over contorting legacy abstractions.
> **Graphify basis:** `graphify-out/graph.json` (3651 nodes, 2026-09-02) re-queried for every section below to avoid context waste. File citations are `path:line` from graph + direct reads where needed.

---

## 1. Current Convox Automation Audit (via Graphify)

### 1.1 Two engines, two persistence models

| Concern | `flows` engine | `automations` engine |
|---------|----------------|----------------------|
| **Tables** | `supabase/migrations/010_flows.sql:77` — `flows {id, account_id, user_id, name, status draft|active|archived, trigger_type keyword|first_inbound_message|manual, trigger_config JSONB, entry_node_id, fallback_policy JSONB}` + `flow_nodes {flow_id, node_key, node_type, config JSONB, position_x,y}` at `L114` + `flow_runs {flow_id, contact_id, conversation_id, trigger_channel, status active|completed|handed_off|timed_out|paused_by_agent|failed, current_node_key, vars, reprompt_count}` at `L156` + `flow_run_events` at `L216` | `supabase/migrations/006_automations.sql:14` — `automations {account_id, user_id, name, trigger_type, trigger_config JSONB, is_active}` + `automation_steps {automation_id, parent_step_id, branch yes|no, step_type, step_config JSONB, position}` at `L53` + `automation_logs {trigger_event, steps_executed[] {status success|skipped|failed}, status success|partial|failed}` at `L87` + shared `automation_pending_executions {flow_run_id|automation_ctx, context JSONB, run_at, status pending}` at `L119` |
| **Trigger catalog** | 3 types only: `keyword` / `first_inbound_message` / `manual` (`src/lib/flows/types.ts:249` `FlowTriggerConfig`). Single trigger envelope. | 15 types: `new_message_received, first_inbound_message, keyword_match, new_contact_created, conversation_assigned, tag_added, time_based, interactive_reply, contact_changed, note_added, task_added, customer_replied, opportunity_created, pipeline_stage_changed, inbound_webhook` (`src/types/index.ts:482` `AutomationTriggerType`). Single `trigger_config` but richer. |
| **Node/step catalog** | 13 `FlowNodeType`: `start, send_message, send_buttons, send_list, send_media, collect_input, condition, set_tag, wait, randomizer, handoff, end` (`src/lib/flows/types.ts:215`). Flat per-content-block nodes (text vs buttons vs list are distinct node types). | 18 `AutomationStepType`: `send_message, send_buttons, send_list, send_template, add_tag, remove_tag, assign_conversation, update_contact_field, create_deal, create_task, randomizer, goal, enroll_in_sequence, wait, condition, send_webhook, close_conversation` (`src/types/index.ts:505`). Sequential list with branching via `parent_step_id+branch`. |
| **Edges** | Inside `config` (`next_node_key`, `buttons[].next_node_key`, `sections[].rows[].next_node_key`, `true_next/false_next`, `variants[].next_node_key`) — `src/lib/flows/types.ts:25` comment `Edges live INSIDE the config`. Resolved via `src/lib/flows/validate.ts:978` `outgoingEdges`. | `parent_step_id+branch` for Condition, flat `position` otherwise. Adapter `src/lib/automations/automation-editor-adapter.ts:39` `stepsToNodes()/nodesToSteps()` converts sequential steps to graph-like nodes for editor (convergence hint already in repo). |
| **Runtime** | `src/lib/flows/engine.ts:1` `dispatchInboundToFlows() L1140` → `findEntryFlow() L386` → `advanceFromNodeKey() L733` (loop over nodes: `isSuspending()/isAutoAdvancing()/isTerminal()`). Suspend at `sendButtonsAndSuspend() L442`, `sendListAndSuspend() L507`, `collect_input` capture at `L798`, `wait` via `automation_pending_executions` at `L915`. Resumes via `handleReplyForActiveRun() L1228`, `resumeFlowWait() L1475`. Fallback `src/lib/flows/fallback.ts:35` reprompt/handoff. | `src/lib/automations/engine.ts:1` `runAutomationsForTrigger() L110` → `triggerMatches() L1048` → `executeAutomation() L263` → `runStep() L510` sequential walk; `wait` enqueues same `automation_pending_executions` at `L297`; `tag_added` cascades at `L495` with depth guard. No suspend for buttons (no active run concept — cross-automation chaining via `interactive_reply` trigger). |
| **Validation** | `src/lib/flows/validate.ts:52` `validateFlowForActivation()` — name, trigger, graph integrity (entry exists, duplicate node_key), per-node Meta limits, reachability BFS `reachableFromEntry() L956`, cycle DFS `findCycle() L921`, channel check `isValidChannel()`. Issues `{severity error|warning, scope flow|trigger|node, node_key, field, message}` (`L29`). | `src/lib/automations/validate.ts:31` `validateStepsForActivation()` — walk `StepLike[]` via `builder-tree.ts:1`, `validateOne()` per type, `validateInteractivePayload()` channel-aware for buttons/lists, `validateTriggerForActivation()` for triggers. Simpler issues `{path, message}` without severity. |
| **Builder** | `src/components/flows/flow-editor-state.tsx:65` `BuilderState` + `flow-canvas.tsx:1` `FlowCanvasInner()` (xyflow, minimap implied, `CanvasAddNodeButton L741`, `NODE_META L94`, `groupNodeTypesByCategory() L196`), `flow-editor-shell.tsx:1`, `header.tsx`, `validation-panel.tsx` — graph-native. | `src/components/automations/automation-builder.tsx:81` `BuilderStep` + `provider.tsx:17` `AutomationEditorState` + `basic-view.tsx` + `automation-editor-adapter.ts:39` — sequential/tree view, not xyflow. Adapter exists to render steps as nodes but not Manychat parity. |
| **Channel layer** | Both use `src/lib/channels/socket.ts:1` `ChannelSocket` → `dispatchText()/dispatchInteractive()/dispatchMedia()` → `src/lib/channels/telegram/send.ts:47` `sendTelegramText()`, `send-media.ts:85` `sendTelegramMedia()`, `keyboard.ts` `validateTelegramInlineMarkup()`, `src/lib/whatsapp/meta-api.ts:1` `sendTextMessage()/sendInteractiveButtons()/sendInteractiveList()`. ChannelTarget `current|whatsapp|telegram` resolved via `resolveChannelTarget() L184` (`flows/engine.ts:175`, `automations/engine.ts:63`, `socket.ts:222`) — `current → trigger_channel snapshot` else explicit, legacy null→whatsapp. |
| **Preview** | `src/lib/flows/dispatch.test.ts:151` `dispatch()` + `flows/engine.test.ts` — no preview widget. Automations has `src/components/automations/test-dialog.tsx:1` + `src/lib/automations/dry-run.ts:1` (`previewAutomationSteps()/previewFlowNodes()`) — single dry-run path. | Same dry-run used for both; no `In Manychat` widget vs `In messengers` native split per spec `§18`. |
| **Analytics** | `flow_run_events` + `flow_runs.status`, `flows.execution_count/last_executed_at`. Automations `automation_logs` + `automations.execution_count`. No per-step conversion rate, no Smart Delay `Waiting/Passed` unique/total. | Same; `broadcasts` metrics separate. |

### 1.2 What this audit reveals

- **Flows graph model is closest to Manychat.** `flow_nodes.node_key` (stable string, not UUID, for cloning — `src/lib/flows/types.ts:15`) + `flow_runs.current_node_key` suspend + xyflow canvas already mirror Manychat's `Automation → Message(container) → block → edge` mental model (§2.1 spec). Flows already has suspending nodes + fallback policy — load-bearing Manychat parity pieces.
- **Automations has richer domain.** Trigger catalog (CRM events, inbound webhook, time_based) + CRM actions (assign_conversation, update_contact_field, create_deal/task) + Sequences (`supabase/migrations/049_sequences.sql:4` + `src/types/index.ts:767`) — missing from Flows. Flows' 3-trigger catalog is a blocking gap for Manychat Rules parity.
- **Dual persistence is accidental complexity for the target.** Keeping two tables + two engines + two validators + two builders + two editor states to achieve what Manychat does with one graph + Starting Step envelope forces every new Manychat feature to be built twice, validated twice, tested twice. `automation-editor-adapter.ts:39` already hints the team felt this (adapter converts steps→nodes). Adapter is a bridge over the wrong abstraction — evidence dual-engine is the wrong primitive for the target.
- **Validation duality is inconsistent.** Flows `error|warning` severity exists; Automations plain `path/message` does not — but Manychat distinguishes warnings (channel mismatch) vs errors (missing required field). Flows is closer; Automations needs severity upgrade regardless.
- **Channel layer is correct and should stay.** `socket.ts:1` + `resolveChannelTarget()` pattern is `MUST MATCH` (§26 spec) and already implements `current` snapshot — preserve.
- **Builder duality is wrong for visual parity.** Only Flows uses xyflow; Automations linear `basic-view.tsx` cannot render Randomizer fan, Condition diamond, Smart Delay window, Start Automation call edge in a Manychat-like way. Visual parity (§4 framing) requires single xyflow canvas with Manychat node cards/handles/branches (§14 spec).
- **Preview & analytics both incomplete vs spec §18/§20.** Single dry-run not split; no per-step conversion.

### 1.3 Graphify signals that confirm the above

- Community hub `flows/engine.ts` cohesion 0.08 with 42 nodes — god node candidates include `flows/engine.ts`, `automations/engine.ts`, `flow-canvas.tsx`, `provider.tsx` — indicates engines are cross-community bridges (cost of duality).
- `graphify-out/GRAPH_REPORT.md` community `flows/engine.ts` + `supabase/client.ts` + `node-config-form.tsx` are separate hubs — builder/editor/validation are not unified.
- `automation-editor-adapter.ts:39` `stepsToNodes()/nodesToSteps()` edge exists — already a graph↔tree translation layer (tech debt if target is graph-native).

---

## 2. Manychat Target Model Recap (from verified spec)

**Single canonical graph + two views over same model** (§1 spec). Starting Step envelope holds `+ New Trigger` list (≥1, OR). Canvas infinite (zoom/pan/auto-arrange/minimap `UNCERTAIN` but expected). Six top-level block families + AI Step:

```
Automation
├── Starting Step (pill, trigger chips, channel badge)
│   └── Triggers (OR) — Keywords (≤10 per rule, 6 rules incl Thumbs Up Messenger-only + AI intent), IG/FB Comments, Story reply/mention/live, Ad click, QR scan, Button/Quick Reply tap (suspend/resume), + global Rules triggers (Date/Time, Pixel, Tag applied/removed, Sequence sub/unsub, Field changed, New contact)
├── Message (container → 1..N Content Blocks: Text/Image/Delay/Data Collection/File/Audio/Video/PDF/Card/Gallery/Messenger List/Dynamic) — channel allowlist per §6 spec, one incoming, N button/row branches
├── Action (container 1..N tasks: Contact data / Automation / Inbox / Ads Optimization CAPI / Integrations) — single next
├── Condition (Does the contact match all/any + 2 outputs matching vs not — Tag/Widget/Ad/API/List/Sequence/Time/Segments/Merge Fields + date offsets)
├── Randomizer (2–6→12 variations % sliders, Random path every time □ unchecked=sticky)
├── Smart Delay (Duration amount+unit + Set continue time limit HH:mm + day filter; or Date Specific/Dynamic CUF date ± offset; Uses contact TZ else account TZ; admin pause adds; Waiting/Overall/Passed stats; does NOT reopen 24h window)
├── Start Automation (Click to Select Automation → Pick This Automation → single next after callee returns; callee flushes messages without button wait synchronously)
└── AI Step (Pro+AI $29 add-on: goal+context 10k + auto tasks + save-to-field + channel auto-set + Save & Start Chat simulator)
```

**Edges:** heterogeneous (`next` vs `button[].next_node_key` vs `true_next/false_next` vs `variants[].next_node_key` vs `Choose Next Step` vs call edge). Many-to-one merge allowed (no forbidding — spec §13.1 correct `INFERRED` default-allow). Pause at buttoned Message / Data Collection 30 min / Smart Delay / callee return.

**Validation severity:** ERROR blocks publish (missing required, duplicate reply_id, sum≠100, dangling edge), WARNING allows publish (unreachable, channel mismatch `will never trigger`), runtime auto-pause after 30 blocks without pause. Analytics per-step Starting Step Conversion Rate + Smart Delay unique/total.

**Plan scope (§21 spec):** Pro = $29/mo 2,500 contacts, 3 channels, unlimited automations; AI Step requires extra $29 add-on (not bundled); Free limited to 3 custom keyword triggers.

---

## 3. Gap Analysis (current → Manychat Pro target)

| Dimension | Current Convox | Manychat Pro target | Gap class |
|-----------|----------------|---------------------|-----------|
| **Persistence shape** | Two tables + two engines | Single graph persisted once, rendered two ways | Replace (dual→unified) |
| **Trigger envelope** | Flows: 3 types, single; Automations: 15 types, single | Multiple triggers OR per automation, ~15 types incl Keywords (6 rules + intent), IG/FB Comments, Ads, live scan, plus global Rules mirror | Refactor (expand + multi) |
| **Message hierarchy** | Flat `send_message/send_buttons/send_list/send_media` distinct node types | One Message node holding `content_blocks[]` (Text+Image+Delay+DataCollection+File/Audio/Video/PDF/Card/Gallery/List/Dynamic) with channel allowlist | Replace (flattened→container) |
| **Actions per node** | Single purpose per node (`set_tag` node vs `add_tag` step) | Action node holds N tasks ordered | Replace |
| **Condition** | Single predicate; Flows `var/tag/contact_field` narrow; Automations `tag_presence/contact_field/message_content/time_of_day` but not widget/ad/list/segments/date offset | `all/any` group + 12 filter types + date formula offsets | Refactor (extend) |
| **Randomizer** | 2–6, sum 100, mode exists but no bucket table | 2–12, sticky bucket per contact persisted, batch quirk awareness | Refactor |
| **Smart Delay** | `wait {amount/unit/until/next}` duration-only, no window | Duration `+ continue between HH:mm + day filter + contact TZ + admin-pause add + max 365d` + Date Specific/Dynamic offset | Refactor (expand) |
| **Start Automation** | Cross-automation via `interactive_reply` trigger chaining only | Graph edge `start_automation {calleeId, next}` synchronous flush, skip button wait | New |
| **AI Step** | Knowledge chunks only, no graph primitive | Graph node goal/context/tasks simulator | New (behind flag) |
| **Graph validation** | Flows has BFS/DFS; Automations simpler; both missing 30-block guard + window validation | Unified `error|warning` with 30-block auto-pause + sum100 + window left<right + sticky etc. | Refactor |
| **Builder UX** | Flows xyflow + Flows editor; Automations linear `basic-view`; adapter bridge | Single xyflow canvas with Manychat cards/handles/branches, side panels per §15 spec, toolbar (rename/undo/redo/Preview/Set Live/⋮), instrument `+` + double-click, Shift+multi-select, auto-arrange, zoom, minimap, duplicate □/delete 🗑 on hover, copy/paste cross-automation, dirty/saved/published split | Replace (unify builder) |
| **Preview** | Single dry-run dialog | `In Manychat` widget (side-by-side, limited: no contact/third-party I/O, manual condition/randomizer, no actions/delays) + `In messengers` native full + Restart prompt | New (split preview) |
| **Analytics** | `execution_count`, `flow_run_events`, `automation_logs` flat | Per-step conversion rate, per-trigger filter, Smart Delay Waiting/Passed unique/total, `Starting Step Conversion Rate` | Refactor |
| **Visual tokens** | Custom Convox cards (message-bubble, card ui) | Manychat-like node cards, hierarchy, icons, handles, branch labels, empty/selected/warning/error/incomplete states per §14, channel badges | Refactor |

---

## 4. Architecture Decision — What Stays / Refactored / Replaced / New

### 4.1 A. What can stay (genuinely useful, keep as-is or adapt)

| Keep | Why | Evidence |
|------|-----|----------|
| `src/lib/channels/socket.ts:1` + `telegram/send.ts:47` / `send-media.ts:85` / `keyboard.ts` / `whatsapp/meta-api.ts:1` | Already implements `current` snapshot + per-channel payload + Telegram flattening — exactly `MUST MATCH` (§26). | Graph `socket.ts` 673-node community hub; validated TG 10 vs WA 3 handling partially. |
| `contact_tags` / `custom_fields` / `contact_custom_values` / `tags` model | Powers Action `Add/Remove Tag`, `Set/Clear User Field`, Condition tag/field checks — aligns with Manychat Tags/CUF/Bot Fields model. | `src/types/index.ts:122` `Tag` etc. |
| Supabase RLS + `account_id, user_id` tenancy col pattern | Must remain for `MUST MATCH` correctness; enrollment gates `accountId` before steps. | `supabase/migrations/017_account_sharing.sql:60` `accounts` |
| `flows/fallback.ts:35` `FlowFallbackPolicy {on_unknown_reply reprompt|handoff|ignore, max_reprompts, on_timeout_hours, on_exhaust}` | Needed for unknown reply handling around button suspend — Manychat analog not separately doc'd but same need. Preserve and surface as `On unknown reply` editor. | `src/lib/flows/fallback.ts:1` |
| `supabase/migrations/049_sequences.sql:4` + `sequence_enrollments` sequencing domain | Manychat Sequences are distinct product (`Setting up Sequences` `14281202572316`) — keep table; distinguish from Smart Delay (Sequences are subscription drips alongside automation, not inside it). | `src/types/index.ts:767` |
| `src/lib/whatsapp/interactive.ts:71` `InteractiveMessagePayload` + `INTERACTIVE_LIMITS` | Already models button/list limits, `validateInteractivePayload() L120` channel-aware branch point — extend rather than replace. | `src/types/index.ts:556` |
| `src/lib/validation/shared.ts:15` `isValidChannel()/validateChannelTarget()` | Foundation for channel mismatch `warning` vs `error` — keep. | `src/lib/flows/validate.ts:27` |

### 4.2 B. What should be refactored (shape retained, internals changed)

| Refactor | To | Why |
|----------|----|-----|
| `src/lib/flows/types.ts:215` `FlowNodeConfig` + `src/types/index.ts:505` `AutomationStepType` | Unified `AutomationNodeConfig` discriminated union with Message container + expanded Wait/SmartDelay + Randomizer 12 + StartAutomation ref + AI Step (behind flag) | Single source for both validation + runtime + builder; kill duality at type level. |
| `src/lib/flows/validate.ts:52` + `src/lib/automations/validate.ts:31` → unified validator | One `validateAutomationForActivation({triggerEnvelope, nodes}) → ValidationIssue[]` with `severity error|warning` + `field/node_key` highlight, graph BFS/DFS, channel allowlist (§6 matrix), 30-block guard, window left<right | Manychat validation requires single rulebook; Flows already has severity+scope, Automations needs upgrade. |
| `supabase/migrations/010_flows.sql:77` `flows.trigger_type` single | `flows.trigger_envelope: {triggers: Trigger[]}` where `Trigger = {id, kind, config, channel?, enabled}` with `OR` dispatch — legacy `trigger_type+trigger_config` kept as compat view (computed column/adapter) | Manychat multiple triggers OR per automation (§5.3). |
| `src/lib/flows/engine.ts:733` `advanceFromNodeKey()` loop (+ `isSuspending()/isAutoAdvancing()`) | Unified engine that handles suspending (buttons/list/collect_input/smartDelay/startAutomation return/AI turn) + sticky bucket + 30-block auto-pause + `resolveChannelTarget()` unchanged | Preserve dispatch skeleton (already graph-native), add missing suspend types. |
| `src/lib/flows/edges.ts:1` `outgoingSlots()/deriveCanvasEdges()` | Canonical edge derivation over Message container inner edges (per-button/row), Condition 2, Randomizer N, SmartDelay 1, StartAutomation 1+call | Today's `outgoingEdges` is flat; container requires multi-handle derivation. |
| `src/components/flows/flow-editor-state.tsx:65` `BuilderState` | Single `AutomationGraphState {nodes, edges, triggers, viewport, dirty, validationIssues, previewMode}` persisted via `flow_nodes` child rows; `automation-editor/provider.tsx` converges into this | Single editor state removes adapter bridge. |
| `supabase/migrations/006_automations.sql:119` `automation_pending_executions {context JSONB}` | Expanded `context` to hold `trigger_channel_snapshot, vars, conversation_id, pendingKind: wait|smartDelayDuration|smartDelayDate|dataCollectionTimeout, resumeNodeKey, windowSpec, contactTzElseAccount` | Smart Delay window semantics require richer resume context than `next_node_key` alone. |

### 4.3 C. What should be replaced (remove after migration)

| Replace / Remove | With |
|------------------|------|
| Dual persistence (`automations` + `automation_steps` as sequential+branch vs `flows` + `flow_nodes`) as two products | Single canonical `flows` family as product `Automations` (rename in UI to `Automations` while table stays `flows` or migrate to `automation_graphs`). Keep `automations` rows as legacy read-only view (compat adapter or one-time migration) then deprecate engine. |
| `src/components/automations/automation-builder.tsx:1` sequential builder + `basic-view.tsx` linear view | Manychat-like xyflow builder as the only canvas; `Basic Builder` is a derived view over same graph (linear filter that hides branching — not a separate storage) per spec §2.2. |
| `src/lib/automations/automation-editor-adapter.ts:39` `stepsToNodes()/nodesToSteps()` as permanent layer | Use once for migration import of existing automations into unified graph; delete after. |
| Two `admin-client.ts` files (`src/lib/flows/admin-client.ts:8` + `src/lib/automations/admin-client.ts:8`) | One `src/lib/automations/graph-admin-client.ts` (shared supabaseAdmin factory). |
| Separate `engine/route.ts` triggers dispatch | Unified dispatch `src/lib/inbound/processNormalizedInbound.ts:235` already calls both — refactor to single `dispatchToAutomationGraph()`. |

### 4.4 D. What new architecture is required

| New artifact | Purpose | Spec § |
|--------------|---------|--------|
| `Message` container node: `MessageContainerConfig { channelTarget?: ChannelTarget, contentBlocks: ContentBlock[] }` where `ContentBlock = Text {text, buttons?}| Image {url}| File| Audio| Video| PDF{url}| Card {image,title,subtitle,buttons}| Gallery {elements[≤10]}| MessengerList{listId}| Dynamic{request_type, url HTTPS, headers, body, fallback_next?}| DataCollection {replyType, targetFieldId, multipleChoiceRows? →branches}| Delay {durationMs, showTyping?}` | Enable one canvas node holding Text+Image+Buttons etc. (Manychat spec §6) — replaces flat send_* node types. |
| `Action` multi-task node: `ActionNodeConfig { tasks: ActionTask[] }` where `ActionTask = AddRemoveTag{tag_id}| SetClearUserField{field_id,value?}| DeleteContact| SetChannelOptInOut| SetBotField| SubscribeUnsubscribeSequence{sequence_id}| MakeExternalRequest{method,url,headers,body,store_response?,response_var?,fallback?}| ChangeMenu| LogConversion| MarkOpenClosed| AssignConversation| NotifyAssignees| SendCapiEvent| IntegrationTask` + ordered execution | Spec §7 Action catalog; sequential, non-branching. |
| `SmartDelay` fuller: `SmartDelayNodeConfig { kind: duration|date, duration?: {amount,unit}, window?: {continueBetween: [HH:mm,HH:mm], days Any|Mon..Sun}, date?: { kind specific|dynamic, datetime?, cUF_DateFieldId?, offset?: {+/-, amount, unit}}, next_node_key }` + `max 365d` cap | Spec §10 |
| `StartAutomation` edge node: `StartAutomationNodeConfig { calleeAutomationId, next_node_key }` with runtime sync flush semantics (skip button wait). | Spec §11 |
| `AiStep` node (flagged): `AiStepNodeConfig { goal:string, context:string(≤10k), channel?: Channel, tasks: {label, saveToField?: {kind system|custom, fieldId}}[], next_node_key }` + `Save & Start Chat` simulator backend | Spec §12 Pro+AI $29 add-on gating. |
| `contact_randomizer_buckets {id, account_id, contact_id, automation_id, node_key, variant_id, assigned_at}` | Persist sticky assignment per spec §9 | Spec §9 |
| `automation_trigger_evaluations` expansion or reuse `051_trigger_evaluations.sql:4` to evaluate `triggers[] OR` with channel filter | Support multiple triggers OR + keyword priority list |
| Preview sandbox: `preview_sessions {id, automation_id, account_id, previewMode: inmanychat|inmessengers, contactSnapshot, stateMasked}` | Split preview §18 — widget limited vs native full |
| Visual state + validation wiring: `ValidationIssue → NodeVisualState {normal|selected|incomplete|warning|error}` map + toolbar/minimap/undo stack (50 entries) + live validation | Spec §14–17 |

### 4.5 E. Dual-engine verdict — unify, do not remain

**Decision: Unify — deprecate automations engine, promote flows graph engine as canonical `Automation` engine.**

Rationale:

- **Product fit:** Manychat target is graph-native with heterogeneous edges (buttons/rows/condition 2/randomizer N/call). Flows already implements node_key + inside-config edges + suspend/resume + xyflow canvas. Automations sequential `position` + `parent_step_id` cannot represent Message container multi-block + multi-handle branching without contortion; adapter `stepsToNodes()` is already a graph-on-top-of-tree workaround (file path `src/lib/automations/automation-editor-adapter.ts:39` evidence of wrong primitive).
- **Domain coverage:** Automations domain knowledge (CRM triggers/actions/Sequences) is valuable but not structural — those catalog items port into the graph engine's node types + trigger kinds without keeping sequential engine. Flows domain (suspend/resume, ChannelTarget snapshot, fallback) is structurally load-bearing for Manychat parity and harder to reimplement on tree engine.
- **Maintainability:** One validator (`src/lib/flows/validate.ts:52` already severity-aware), one engine loop (`advanceFromNodeKey()`), one editor state (`flow-editor-state.tsx:65`), one persistence shape (`flow_nodes` child rows) — versus two of each forever. Copying every Manychat feature (Smart Delay window, 12-variation randomizer, Start Automation call edge) into both engines doubles cost and divergence risk (Graphify hub `flows/engine.ts` + `automations/engine.ts` bridge edges evidence).
- **Migration path exists:** `stepsToNodes()/nodesToSteps()` already translates sequential+branch steps into graph nodes for editor. Reuse as one-time migration: read `automations` rows, call `stepsToNodes()`-equivalent importer to produce `flows` rows with enriched Message containers + Action containers, write `flow_nodes`. Keep `automations` read-only for rollback.
- **Visual parity:** Only Flows has xyflow parity pieces (`flow-canvas.tsx:1` + `flow-editor-state.tsx:1`). Manychat builder is xyflow-native; unifying builder around this is direct.

**What stays of automations engine:** Its trigger catalog (→ merged into flows trigger envelope), step config shapes (→ Action/Condition/Randomizer/Goal fields ported as graph node configs), and Sequence domain (`sequences` tables) — not its execution loop or sequential storage.

---

## 5. Proposed Unified Architecture (Manychat-Pro inside Convox)

### 5.1 Data model (authoritative)

```
flows (canonical product "Automations" — prefer keeping table name flows to avoid data migration rename, or alias view automation_graphs)
├── id, account_id, user_id, name, description, status draft|active|archived
├── trigger_envelope JSONB: { triggers: [{id, kind: keyword|keyword_match|instagram_comments|facebook_comments|story_reply|story_mention|live|ad_click|qr_scan|interactive_reply|first_inbound_message|new_message_received|tag_added|tag_removed|sequence_subscribed|sequence_unsubscribed|custom_field_changed|system_field_changed|new_contact|date_time|log_conversion, channel?: any|whatsapp|telegram, config: TriggerConfig, enabled: boolean }], keywordPriority?: string[] }  // OR dispatch, legacy trigger_type/trigger_config kept as generated columns for compat
├── entry_node_key TEXT FK → flow_nodes.node_key (or first Message/Action if entry points at node_key)
├── fallback_policy JSONB {on_unknown_reply reprompt|handoff|ignore, max_reprompts, on_timeout_hours, on_exhaust handoff|end} // keep src/lib/flows/fallback.ts:35
├── channel_defaults JSONB? { authoringChannel any|whatsapp|telegram } // ephemeral in editor, not persisted per builder-ux-model §3 — derive, don't persist
├── execution_count INT, last_executed_at TIMESTAMPTZ, stats_snapshot JSONB (per-step conversion cache)
├── version INT, created_at, updated_at

flow_nodes
├── id, flow_id → flows.id, node_key TEXT UNIQUE per flow (stable string for cloning — src/lib/flows/types.ts:15)
├── node_type: message | action | condition | randomizer | smart_delay | start_automation | ai_step
├── config JSONB: discriminated union below
├── position_x, position_y, created_at
│   // legacy DB CHECK node_type enum expanded to new set; 046_allow_wait_node_type.sql pattern reused

flow_runs (contact-scoped execution state)
├── id, flow_id, account_id, user_id, contact_id, conversation_id, trigger_channel whatsapp|telegram|null
├── status active|completed|handed_off|timed_out|paused_by_agent|failed
├── current_node_key TEXT, last_prompt_message_id TEXT, vars JSONB, reprompt_count INT
├── pending_kind wait|smartDelayDuration|smartDelayDate|dataCollectionTimeout|aiTurn|null
├── pending_until TIMESTAMPTZ, pending_context JSONB {resumeNodeKey, windowSpec?, contactTzElseAccount?, varsSnapshot, conversationId}
├── ai_session_ref TEXT?, started_at, last_advanced_at, ended_at, end_reason
└── (existing plus pending_until for Smart Delay window)

contact_randomizer_buckets (new)
└── id, account_id, contact_id, flow_id, node_key, variant_id, assigned_at UNIQUE(account_id,contact_id,flow_id,node_key)

automation_trigger_evaluations (reuse/extend 051)
└── add column flow_id + trigger_id + matched boolean for OR diagnostics

preview_sessions (new, preview split §18)
└── id, account_id, flow_id, mode inmanychat|inmessengers, created_by_user_id, state JSONB, masked boolean

legacy automations + automation_steps (read-only compat after migration)
└── keep for rollback, add view v_automation_graphs that recomputes nodes via importer
```

**Node config discriminated union (new canonical):**

```ts
// Message is now the single way to send — replaces send_message/send_buttons/send_list/send_media
type MessageContainerConfig = {
  // Manychat shows Messenger vs Instagram message as channel-specific message node type —
  // Convox captures as channelTarget inside Message (locked WA for templates if needed) + contentBlock allowlist filter.
  channel_target?: ChannelTarget; // current|whatsapp|telegram — resolveChannelTarget() L184 unchanged
  content_blocks: (
    | { kind: "text"; text: string; buttons?: Button[] } // Button {reply_id,title,next_node_key, kind? url|call|flow|node }  ≤20 chars; WA 3 / TG 10 enforced channel-aware
    | { kind: "image"; url: string; caption?: string }
    | { kind: "delay"; durationMs: number; showTyping?: boolean }
    | { kind: "data_collection"; prompt_text: string; reply_type: "text"|"email"|"phone"|"number"|"url"|"file"|"image"|"location"|"multiple_choice"; target_field_id?: string; var_key?: string; validation?: "any"|"email"|"phone"|"regex"; regex?: string; choices?: {label, reply_id, next_node_key}[]; notResponded_next?: string; timeoutMs?: 1800000 } // 30 min
    | { kind: "file"; url: string; filename?: string }
    | { kind: "audio"; url: string }
    | { kind: "video"; url: string; caption?: string }
    | { kind: "pdf"; url: string }
    | { kind: "card"; image_url: string; title: string; subtitle?: string; action_url?: string; buttons?: Button[]; image_aspect_ratio?: "horizontal"|"square" }
    | { kind: "gallery"; elements: {image_url,title,subtitle?,action_url?,buttons?}[] /* ≤10 */; image_aspect_ratio? }
    | { kind: "messenger_list"; list_id: string } // Messenger-only
    | { kind: "dynamic"; request_type: "POST"|"GET"|"PUT"|"DELETE"; url: string; headers?: Record<string,string>; body?: string; fallback_next?: string; response_format?: "v2" }
  )[];
};

type ActionNodeConfig = {
  tasks: (
    | { kind: "add_tag"; tag_id: string }
    | { kind: "remove_tag"; tag_id: string }
    | { kind: "set_user_field"; field_id: string; value: string }
    | { kind: "clear_user_field"; field_id: string }
    | { kind: "delete_contact" }
    | { kind: "set_channel_opt_in_out"; channel: "whatsapp"|"telegram"|"sms"|"email"; opt: "in"|"out" }
    | { kind: "set_bot_field"; field_id: string; value: string }
    | { kind: "subscribe_sequence"; sequence_id: string }
    | { kind: "unsubscribe_sequence"; sequence_id: string }
    | { kind: "make_external_request"; method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; body_template?: string; store_response?: boolean; response_var?: string; fallback_next?: string }
    | { kind: "change_menu"; menu_id: string } // Messenger-only
    | { kind: "log_conversion"; event: string; value?: number }
    | { kind: "mark_conversation"; status: "open"|"closed" }
    | { kind: "assign_conversation"; mode: "specific"|"round_robin"; agent_id?: string }
    | { kind: "notify_assignees"; channel: "email"|"sms"; body: string }
    | { kind: "send_capi_event"; event: string; payload?: Record<string,unknown> }
    | { kind: "integration"; provider: string; config: Record<string,unknown> }
  )[];
  next_node_key: string;
};

type ConditionNodeConfig = {
  match: "all"|"any";
  conditions: { subject: "tag"|"widget"|"ad"|"api_opt_in"|"list_available"|"list_subscribed"|"sequence"|"current_time"|"segment"|"system_field"|"custom_user_field"|"custom_bot_field"; subject_key: string; operator: "equals"|"contains"|"present"|"absent"|"gt"|"lt"|"gte"|"lte"; value?: string; dateOffset?: {amount, unit} }[];
  true_next: string; false_next: string;
};

type RandomizerNodeConfig = {
  variants: { id: string; label: string; weight: number; next_node_key: string }[]; // 2–12, sum 100 (OBSERVED 12)
  mode?: "sticky"|"random"; // sticky = default unchecked per 14281151100060
};

type SmartDelayNodeConfig = {
  kind: "duration"|"date";
  duration?: { amount: number; unit: "minutes"|"hours"|"days" }; // max 365d
  window?: { continueBetween: [string,string]; days: "any"|string[] }; // continue HH:mm, left<right publish error OBSERVED
  date?: { kind: "specific"|"dynamic"; datetime?: string; cUF_DateFieldId?: string; offset?: { sign: "+"|"-"; amount: number; unit: "minutes"|"hours"|"days" } };
  next_node_key: string;
};

type StartAutomationNodeConfig = { callee_flow_id: string; next_node_key: string }; // sync flush, skip button wait

type AiStepNodeConfig = {
  goal: string; context: string; // ≤10k chars
  channel?: ChannelTarget; // auto-set from previous node's channel if not first
  tasks: { label: string; saveToField?: { kind: "system"|"custom"; fieldId: string } }[];
  next_node_key: string;
};

type FlowNodeConfig =
  | { node_type: "message"; config: MessageContainerConfig }
  | { node_type: "action"; config: ActionNodeConfig }
  | { node_type: "condition"; config: ConditionNodeConfig }
  | { node_type: "randomizer"; config: RandomizerNodeConfig }
  | { node_type: "smart_delay"; config: SmartDelayNodeConfig }
  | { node_type: "start_automation"; config: StartAutomationNodeConfig }
  | { node_type: "ai_step"; config: AiStepNodeConfig } // flagged
  | { node_type: "handoff"; config: HandoffNodeConfig } // keep
  | { node_type: "end"; config: Record<string,never> };
```

**Convox implication:** This collapses 13+18 legacy types into 9 graph primitives where `message` alone covers ≥10 legacy send_* variants — cleaner than adding 10 more flat node types.

### 5.2 Runtime architecture (unified engine)

```
Inbound normalized pipeline: src/lib/inbound/processNormalizedInbound.ts:235
  → trigger_envelope OR dispatch (keyword priority list per 14281211785884 — first matching wins)
  → unified dispatchUntoGraph({accountId, contactId, conversationId, channel, message: ParsedInbound ∪ CRMEvent})
     ├── load flows where status=active + triggers enabled (one query, not flows+automations union)
     ├── for each candidate: triggerMatches(trigger, inbound, {channelFilter, keywordRules (exact/contains/word/begins_with/thumbsUp/doesntContain+compound), intent?”, list, segment…})
     ├── if match → startNewRun() (flow_runs: current_node_key=entry_node_key, vars={}, trigger_channel=channel snapshot)
     └── else if active run exists for (contactId, flowId) + inbound.reply_id matches suspending Message → handleReplyForActiveRun() (resume via matchReplyId L77)
        └── else fallback reprompt/handoff per FlowFallbackPolicy L333

advanceFromNodeKey loop (keep src/lib/flows/engine.ts:733 skeleton, expand switch):
  switch node_type:
    message: send blocks sequentially via ChannelSocket.dispatchText/Media/Keyboard(); if last ContentBlock has buttons/list choices → suspend (store pending_kind=dataCollection? else messageWait), return; else continue to implicit next (derived from last block's next or Message container's next if no branching)
    data_collection content inside message: same suspend but record vars target + validation; resume via next text reply → vars[var_key]=trim(captured) → advance
    action: for task in tasks sequential: run task (contact_tags insert/delete, contact_custom_values upsert after ownership guard, sequences subscribe, external fetch with timeout 75s video/10s other, CAPI etc.); log non-fatal warning and continue per flows/engine 904 pattern; then advance to next_node_key
    condition: evaluate all/any group (contact state from DB snapshot); advance true_next/false_next
    randomizer: if mode=sticky → SELECT contact_randomizer_buckets where account/contact/flow/node; if exists use variant, else pick weighted random per weight% (sum 100 validated), INSERT bucket; else random pick; advance chosen next
    smart_delay: compute resumeAt:
              if kind=duration: base = now + amount*unit;
                  if window continueBetween: align to next window occurrence in contact TZ else account TZ; day filter Any|specific; add admin-pause duration if paused flag
              if kind=date specific: base = datetime;
                  if kind=date dynamic: base = CUF_DateField value ± offset;
              enqueue automation_pending_executions {flow_run_id, run_at=resumeAt, pending_kind, pending_context:{resumeNodeKey, windowSpec, varsSnapshot}};
              suspend run (status active, current_node_key = this node)
    start_automation: load callee flow nodes; flush callee messages sequentially via ChannelSocket (skip any message suspend — do not store pending), do NOT wait for button replies (per 14281157602716 ⚠️); on callee completion → resume caller at next_node_key
    ai_step: delegate to AI loop (LLM with goal+context 10k + tasks; turn-taking with contact; saveToField per turn; completion→next)

cron resume: resumeFlowWait() at ~L1475 reads pending where run_at ≤ now; for SmartDelay window case re-check window (queuing until window opens per spec §10.2 INFERRED); then advanceFromNodeKey(resumeNodeKey) with varsSnapshot + original trigger_channel preserved (so current resolves to snapshot not new inbound channel)

Limits: 30 blocks without pause guard inside advance loop — count consecutive non-suspending nodes; if ≥30 and next is non-pause → auto-pause (insert pending or handoff) per verified spec.

Pending/reprompt/idempotency unchanged: isDuplicateInbound() L360 duplicate meta_message_id ignored; fallback L35 still reprompt/handoff.

ChannelTarget: keep resolveChannelTarget() L184 legacy null→whatsapp compat; but new automations must pass channel_target required validation (warn not error for trigger mismatch).
```

### 5.3 Builder architecture (visual parity)

```
Single product "Automations" (route /automations, not separate /flows)

<AutomationGraphShell> layout per verified research:
  header: rename Automation title (click) • undo/redo (header buttons + Cmd+Z / Cmd+Shift+Z) • Preview ▾ (In Manychat widget vs In messengers native) • Set Live (publish, publish-blocking errors badge) • ⋮ menu
  right sidebar: Flow/Basic toggle (both render same nodes — Basic is linear filtered view that hides fan branches per spec §2.2; do NOT duplicate storage) • instrument bar (Message/Actions/Conditions/Randomizer/Smart Delay/Start Automation/AI Step) • zoom controls + auto-arrange + fit/minimap
  canvas: xyflow <FlowCanvasInner> derived from src/components/flows/flow-canvas.tsx:1 (already graph-native) with per-node types:
    MessageContainerNode.tsx — shows stacked content_blocks preview truncated per channel, channel badge, handle per button/row (one handle per outgoing), inline + More overflow; duplicate □ + delete 🗑 on hover
    ActionNode.tsx — icon + N tasks chip, side panel with category picker (Recently used/Contact data/Automation/Inbox/Ads Optimization/Integrations per 17636378650268)
    ConditionNode.tsx — diamond, Does the contact match all/any toggle, two labeled handles Matching vs Not
    RandomizerNode.tsx — split diamond, N % labeled handles, Random path every time □
    SmartDelayNode.tsx — hourglass with duration/window/day pill or Until datetime, Choose Next Step handle
    StartAutomationNode.tsx — link icon + callee name, call edge dot→drag to next
    AiStepNode.tsx — chat bubble goal preview, tasks chip, channel auto badge (flagged)
  state: <UnifiedGraphProvider> ← merge src/components/flows/flow-editor-state.tsx:65 BuilderState + src/components/automations/automation-editor/provider.tsx:17 into single AutomationGraphState {nodes, edges, triggers, viewport, dirty, validationIssues, previewMode, selectedId, history[50]}
  side panels: NodeType → config form per spec §15 (Trigger panel left; Message container with content_blocks accordion + drag blue highlight + Variables { } picker; Action panel task list + +Action category grid; etc.) — channel allowlist matrix src/specs/channel-capabilities.md gating hides/disables unsupported blocks/buttons (validate mirrors hide)
  empty/selected/warning/error/incomplete visual states per §14 — ValidationIssue.severity→badge (red error / yellow warning); unreachable flag; 30-block hint
  connection handles: Click dot → drag to target; Starting Step pill dot draggable to change entry (verified); per-button handle generation via src/lib/flows/edges.ts:1 deriveCanvasEdges()
  publish gate: save draft allows incomplete (via API PUT), activate requires validateAutomationForActivation() error-free (via POST /api/automations/[id]/activate)
```

**Keep xyflow as Manychat-like choice:** Already in repo (`@xyflow/react` in package per flows canvas). No need to replace with canvas library — just converge the two providers.

### 5.4 API / validation / preview / analytics

```
APIs (unified under /api/automations — flows routes alias for backward compat):
  GET    /api/automations                     list (with trigger filter + trigger state filter per 14281111044124)
  POST   /api/automations                     create blank (Start From Scratch — verified)
  GET    /api/automations/[id]                read graph + trigger envelope
  PUT    /api/automations/[id]                save graph (draft — allows incomplete)
  POST   /api/automations/[id]/activate       validateAutomationForActivation() gate → set status active
  POST   /api/automations/[id]/duplicate      clone (folders/naming handled in list layer — verify folder model or add tags)
  POST   /api/automations/import              steps→nodes importer (existing automations → flows graph)
  GET    /api/automations/[id]/runs           per-trigger + per-step stats (derive from flow_run_events)
  POST   /api/automations/[id]/preview        {mode: inmanychat|inmessengers, contactSnapshot?} → preview_sessions + streamed steps

Validation: single src/lib/automation/validate.ts (merge src/lib/flows/validate.ts:52 + src/lib/automations/validate.ts:31)
  — three categories: trigger sanity (keywords≥1, ≤10 per rule, match_type enum, channel mismatch warning), graph integrity (entry exists, dangling edge error, duplicate node_key error, duplicate reply_id error, unreachable warning, cycle error via findCycle), Meta limits (button ≤20, WA ≤3/TG ≤10, list ≤10 rows total etc., sum 100).
  Issues {severity error|warning, scope flow|trigger|node, node_key, field, message} consumed by validation-panel.tsx:1 for inline highlight.

Preview: two implementations
  inmanychat — smartphone widget side-by-side (no login) per spec §18.1: render Text/Image/Buttons/... as would appear, condition/randomizer visible only to creator (manual choose path), other automations not previewed, actions/smartDelay/startAutomation not executed, data collection validation skipped, SMS/Email disabled. Server preview_sessions.state masked.
  inmessengers — native login required, full execution incl integrations via real ChannelSocket (charges apply disclaimer).

Analytics: per node requested-for reports derived from flow_runs + flow_run_events + automation_pending_executions counts
  — Smart Delay Overall/Waiting/Passed unique/total (pending counts), per-step Starting Step Conversion Rate (reached ÷ unique starters), trigger filter.
```

---

## 6. Implementation Phases (dependency-ordered, Manychat as guiding invariant)

> **Rule per framing correction:** Every phase asks `Will this help us build a genuinely Manychat-like automation platform inside Convox?` If yes, pursue even if it touches graph schema, runtime, APIs, builder state, storage.

### Phase 0 — Frozen audit + scaffolding (no parity yet, but load-bearing)

- Commit verified spec as source-of-truth anchor (done: `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md:1` + `§29` verification).
- Add `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md` (this doc) as architecture decision record.
- Add Graphify guard: snapshot `graphify-out/GRAPH_REPORT.md` for pre-unification diff baseline.
- Add feature flag `ENABLE_MANYCHAT_PARITY_GRAPH` (boolean, default false in prod) gating unified canvas/engine paths.
- **Exit:** Flag exists, no behavior change on prod paths; plan is reviewable.

### Phase 1 — Unified graph persistence + trigger envelope (foundation for everything else)

**Why first:** All builder + validation + runtime + preview + analytics hang off graph shape + trigger envelope. Must land before any node work.

- **Schema migrations (forward-compatible, non-destructive):**
  1. Extend `flow_nodes.node_type` CHECK: add `message | action | condition | randomizer | smart_delay | start_automation | ai_step | handoff | end` (superset of current 13 + new). Keep existing rows valid.
  2. Add `flows.trigger_envelope JSONB` (new) with GIN index; back-populate from `trigger_type/trigger_config` via SQL: `trigger_envelope = {triggers:[{id, kind: legacyKind, channel, config: trigger_config, enabled:true}], legacyKind}`. Keep legacy columns as `GENERATED` or adapter view for rollback.
  3. Add `contact_randomizer_buckets` table (id, account_id FK, contact_id FK, flow_id FK, node_key, variant_id, assigned_at, UNIQUE(account_id,contact_id,flow_id,node_key)) — for sticky buckets per spec §9.
  4. Add columns to `flow_runs` for pending window: `pending_kind, pending_until, pending_context JSONB` (expand existing pending pattern). Keep `automation_pending_executions` as resume table (both engines use today) but add `windowSpec/contactTz` into `context`.
  5. Add `preview_sessions` table for split preview.
- **Code:**
  - New type `src/lib/automation/graph-types.ts` single discriminated union `AutomationNodeConfig` as in §5.1 (authoritative after this phase — `src/lib/flows/types.ts:215` becomes compat re-export).
  - Adapter `src/lib/automation/legacy-adapter.ts` — `stepsToGraph() / graphToSteps()` using existing `automation-editor-adapter.ts:39` logic expanded to Message container + Action container (so existing automations can be imported).
  - Migration CLI `npm run db:migrate:triggers` populating `trigger_envelope` for all flows.
- **Gate:** Behind `ENABLE_MANYCHAT_PARITY_GRAPH`; old paths call adapter, so no prod break. Tests: graphify edge `reachableFromEntry() L956` + `findCycle() L921` unchanged; new envelope query covered.

### Phase 2 — Unified validator + visual parity shell (builder looks like Manychat before behavior)

- Merge validators: new `src/lib/automation/validate-graph.ts` that supersedes both `src/lib/flows/validate.ts:52` + `src/lib/automations/validate.ts:31`. Single severity model `error|warning`, channel allowlist matrix `docs/specs/channel-capabilities.md` as allowlist, 30-block guard (warning), Randomizer 2–12 sum100, window left<right (error OBSERVED), cycle DFS with pause-escape (warn if cycle without wait/condition), duplicate reply_id error, unreachable warning.
- Build unified `AutomationGraphShell` (+ header toolbar: rename, undo/redo 50 stack, Preview ▾, Set Live, ⋮ ; right sidebar Flow/Basic toggle + instrument bar; canvas xyflow + minimap + zoom + auto-arrange). Start from `src/components/flows/flow-canvas.tsx:1` + `flow-editor-state.tsx:65` as base; deprecate `automation-builder.tsx:81` linear view after `Basic` derived view ships (linear filtered render, not storage).
- Implement node cards `MessageContainerNode, ActionNode, ConditionNode, RandomizerNode, SmartDelayNode, StartAutomationNode, AiStepNode( flagged hidden until Phase 5)` with hover duplicate/delete, per-button handles (`src/lib/flows/edges.ts:1` derive), empty/selected/warning/error/incomplete states §14, channel badges, toolbar.
- Wire `validation-panel.tsx:1` to severity badges + inline field highlight (`field` dot-path).
- **API:** unify routes under `/api/automations` with alias for `/api/flows` (reuse `activate/route.ts:21` pattern but dedup). `PUT` save draft (allows incomplete), `POST .../activate` validates.
- **Preview skeleton:** header Preview button dropdown + inmanychat widget shell (no logic yet — placeholder masked).
- **Exit:** New builder renders existing flows as Manychat-like graph with warnings/errors; no engine switch yet.

### Phase 3 — Message container + Action container (the two biggest modeling gaps §6 + §7)

- **Message container** (P1 per parity matrix): replace `send_message / send_buttons / send_list / send_media` flat types with `message {channel_target, content_blocks[]}`. Implement editor `MessageContainerPanel` per §15.2 (content_blocks accordion + drag + `More` + Variables `{}` + per-channel hide). Implement `deriveCanvasEdges()` over container inner button/row next handles. Migrate existing flat nodes → container one-liners via import adapter. Update `validateInteractivePayload() L120` channel-aware for TG 10 vs WA 3 inside container.
- **Action container** (P1): replace single-purpose set_tag node vs sequential steps with `action {tasks[] next}`. Editor `ActionPanel` category picker (Recently used/Contact data/Automation/Inbox/Ads Optimization/Integrations per `17636378650268`). Update `builder` todo: `src/components/flows/shared.tsx:94` `NODE_META` etc. Ensure sequential exec (continue on warning per `flows/engine.ts:904` pattern).
- Add `Card / Gallery / File / Audio / Video / PDF` content block renderers to Message container (channel allowlist Matrix §24 — hide unsupported per channel). PDF preview in chat already hinted via `157?` media handling — reuse.
- **Exit:** One canvas Message node can now hold Text+Image+Buttons etc. as in Manychat (§6 `You can add multiple blocks... within a single message node` verified). One Action node holds N tasks sequential — Manychat spec parity.

### Phase 4 — Core runtime parity (pause semantics + randomization + smart delay + start automation)

- **Unified engine loop:** Merge `src/lib/flows/engine.ts:733` + `src/lib/automations/engine.ts:263` loop into `src/lib/automation/engine.ts` (new). Keep `resolveChannelTarget()` unchanged. Add suspend types:
  - Message button/list suspend: `sendButtonsAndSuspend() L442` pattern generalized to `MessageContainer` last content block branch.
  - Data Collection suspend + 30-min timeout: add `pending_kind=dataCollectionTimeout` with `automation_pending_executions` timeout resume → captured var `{{vars.name}}`.
  - Smart Delay suspend: `kind duration + window + day filter` + `kind date` (specific vs dynamic CUF date ± offset) per §10, contact TZ else account TZ, admin-pause add, `max 365d`, 24h window does NOT reopen caveat (doc note + workaround per §10.2).
  - Randomizer sticky bucket: weighted random via `weight` (percent) + mode `sticky→INSERT bucket` / `random→no bucket` + batch quirk not needed (we do true weighted).
  - Start Automation sync flush: load callee nodes, flush messages without suspend, return to caller's `next_node_key` (per `14281157602716` ⚠️). Detect cycle across automations (DFS across callee ids) → warning.
- Implement `30 blocks without pause → pause automatically` guard inside loop (verified spec `§60`).
- Implement `contact_randomizer_buckets` read/write path + tests (`src/lib/flows/p2-randomizer.test.ts:6` etc. already covers some).
- Implement `trigger_envelope OR dispatch` with keyword priority list (`14281211785884` — first matching wins) and IG/FB Comments conditions (include→exclude, scope specific post vs any).
- Keep `fallback.ts:35` policy for unknown reply.
- Add `src/lib/automation/trigger-evaluate.ts` handling all trigger kinds (port Automations rich catalog into graph engine).
- **Exit:** Execution behavior matches Manychat target for all P1 runtime primitives; existing `dispatchInboundToFlows()` + `runAutomationsForTrigger()` paths converge.

### Phase 5 — Previews + validation polish + API cutover (functional parity before AI)

- **Split preview:** `In Manychat` widget (smartphone side-by-side, masking contact/third-party I/O, manual choose path for condition/randomizer, no actions/delays, data collection validation skipped, SMS/Email disabled) vs `In messengers` native full (requires login, charges disclaimer) per §18.1. Store `preview_sessions` masked state; Restart prompt.
- **Validation polish:** cover window left≥right `OBSERVED` error, Randomizer 12, channel-mismatch `warning` (not error), per-field highlights `field` dot-path, header warning bar for cycle, folder/naming guidance (folder model TBD vs automation interest — at minimum list filters `Search by triggers / trigger state` per `14281111044124`).
- **API cutover:** Promote unified routes `/api/automations/*` to primary; keep `/api/flows/*` as alias that proxies through legacy adapter for rollback window (one minor release). Remove dual dispatch in `processNormalizedInbound.ts:235` — single `dispatchToAutomationGraph()`.
- **Analytics v1:** Per-step `Starting Step Conversion Rate` + per-trigger filter + Smart Delay `Overall/Waiting/Passed` unique/total derived from pending counts + `flow_run_events`. Keep dashboard Metrics table lightweight (no historical drill until P2).
- **Migration:** Provide `POST /api/automations/import {automationId}` that calls `stepsToGraph()` over existing `automations` rows for customers with legacy automations — run once on upgrade, rows remain read-only.
- **Exit:** Builder + runtime behave as Manychat P1 (everything except AI Step ideal). Manual QA against Help Center screenshots for `14281166306332` flow creation steps passes.

### Phase 6 — Manychat-Pro completeness (Sequences distinct product, Dynamic, analytics depth)

- Promote `sequences` from integrated `enroll_in_sequence` task to first-class Sequences product (per `14281202572316` — per-message enabled, delays, subscribe via Action button / Bulk / contact profile, stuck/not-subscribed diagnostics). Sequences remain separate from Smart Delay per audit §4.1 keep — do NOT model Sequence as delay node.
- **Dynamic block** full `Dev Tools: Dynamic block` parity (`14281268533788` + `26673580447900`): `GET|POST|PUT|DELETE HTTPS URL + headers/body + Test Request per contact + fallback_next + response `v2` format validated; errors logged `Settings→Logs` mirror.
- **Messenger List** content block (Messenger-only) + Card/Gallery channel polish (1.91:1 aspect verified).
- **Analytics depth:** folder earned column, per-folder compare, 30-day window toggles per HighLevel wisdom `builder-ux-model.md:45`, per-step delivery/open/click.
- **Exit:** Gap matrix P2 cleared.

### Phase 7 — AI Step (flagged, $29 add-on-gated)

- **Why last:** AI Step is `Pro+AI $29 add-on` not bundled (§21), flagged `P3/P4` in spec §12. Requires LLM loop, goal/context 10k panel, task saveToField wiring, `Save & Start Chat` simulator backend, channel auto-set, handoff behavior `UNCERTAIN` until live-account verify — do not gate P1 parity on it.
- Implement `ai_step` node with wizard (Goal → Context → Generate → tasks list + edit + New Task + channel picker + chat simulator widget) per §12; guard behind `isFeatureEnabled(account, "ai_step")` checking Pro+AI entitlement.
- Align with `AI Flow Builder assistant` 8-step chat bottom generator (business→goals→channel→template→trigger→generate ≤30s→Use) as separate command palette contribution, not graph node — `P4` scope per `builder-ux-model.md:61`.
- **Exit:** Pro parity + AI add-on parity achieved; behind entitlement, not default.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migrating existing `automations` rows hastily breaks prod | Medium | Phase 1 adapter keeps legacy columns as generated compat + read-only legacy view + `import` endpoint instead of drop; flag `ENABLE_MANYCHAT_PARITY_GRAPH` guards new graph paths until Phase 5 cutover. |
| Flattened→Container migration mangles `reply_id` branching | Medium | Derive `outgoingSlots()` over container inner handles before migration; validate migration with `reachableFromEntry()` + `findCycle()` snapshot pre/post; write back-test `p1-flow-regression.test.ts L1` etc. |
| Smart Delay window TZ quirk infinite defer if window never occurs | Low | Validate `days Any` at least; publish warn if window `continueBetween` + `days specific` yields no occurrence within 365d cap; spec §10.2 window-queuing stays `INFERRED` until Help Center confirms — code path with tests for 20:00–21:00 reschedule. |
| 30-block guard creates unexpected pause in long linear flows customers built expecting no pause | Medium | Guard is warning-tier at publish (`ValidationIssue warning`) + auto-pause is idempotent — resume immediately to next node on next tick if no window; log guidance `break with Smart Delay` per verified tip `Folders + Start Automation to break down large automations`. |
| Visual parity diverge due to unverified palette (`UNCERTAIN` §14) | High | Treat §14 palette as `SHOULD MATCH` not `MUST`; ship functional layout + handles + badges first; capture live Manychat Pro account screenshots before final pixel pass (spec §14 `needs live capture`). |
| AI Step handoff semantics `UNCERTAIN` | High | Ship flagged behind entitlement; default hidden; re-verify with live account before enabling. |

---

## 8. Decision Log (this doc is the decision)

| Decision | Replaces | Graphify evidence | Spec consequence |
|----------|----------|-------------------|------------------|
| Unify persistence to `flows` graph family | Dual `flows` + `automations` engines | `flows/engine.ts L733` suspend vs `automations/engine.ts L110` sequential — structural mismatch; adapter `stepsToNodes()` exists | One validator + one runtime + one builder state |
| Message as `content_blocks[]` container | Flat `send_message/send_buttons/send_list/send_media` distinct types | `src/lib/flows/types.ts:39` buttons array already inside one type; spec §6 `You can add multiple blocks within a single message node` verified | §6 parity direct |
| Action as `tasks[]` ordered | Single-purpose node per action | `17636378650268` `Each Actions step can include multiple tasks` verified | §7 parity direct |
| Trigger envelope `triggers[] OR` + keyword priority list | Single trigger + single config | `14281211785884` ≤10 per rule + priority drag; `14281170185628` multiple triggers OR per rule | §5 parity direct |
| Keep `socket.ts:1` channel layer unchanged | — | `resolveChannelTarget()` pattern verified core | §2.4 `current` snapshot preserved |
| Defer AI Step to Phase 7 behind `Pro+AI` flag | — | `25800228332572` + `manychat.com/product/ai` AI requires add-on $29, flagged P3/P4 | §12 not gated P1 |

---

## 9. What To Do Next (awaiting approval)

- Review this plan vs `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md:1` + `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md §29` verification report.
- Confirm whether to proceed with Phase 0 (flag + scaffolding) or request adjustments to phasing (e.g., ship AI Step earlier, or keep `automations` table name as product name).
- No code/migration/commit will be made until phase sequencing is approved.

