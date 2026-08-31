# ConvoxOS Automation Product — Target Contract (2026-08-31)

> Derived from `docs/research/manychat-model.md` + `highlevel-model.md` + `channel-behavior.md`.
> This is the authoritative product definition. Implementation must satisfy it before claiming parity.

## 1. Product Positioning

**ConvoxOS target = ManyChat Pro conversational automation + HighLevel workflow automation + CRM-native AI/Knowledge in one system.**

```
                        CONVOXOS
                           │
           ┌───────────────┴───────────────┐
           │                               │
    CONVERSATIONAL                  CRM / BUSINESS
     AUTOMATION                      AUTOMATION
           │                               │
     ManyChat model                  GHL model
     (blocks, inputs,               (triggers, CRM
      pauses, reuse)                 actions, goals)
           │                               │
           └─────────────┬─────────────────┘
                         ↓
                ONE AUTOMATION LAYER
                         ↓
           ┌─────────────┼─────────────┐
           ↓             ↓             ↓
      Conversation     CRM            AI
           ↓             ↓             ↓
       Messages      Pipeline        Knowledge
       Channels      Deals            Agents
       Replies       Tasks            Decisions
```

**CRM Core → Automation ↔ Conversation ↔ Channels ↔ AI ↔ Knowledge** (see §13).

The builder is the control surface. The CRM is automation-aware. The automation is CRM-aware.

## 2. Automation Product Model

### 2.1 What is an Automation?

A durable, channel-neutral program that enrolls contacts (and where applicable opportunities) on triggers, runs a graph of nodes, may pause waiting for input or time, mutates CRM state, and records auditable history. Published automations are live; drafts are editable without affecting live runs.

### 2.2 Two Engines, One Product Surface

- **Flow engine:** conversational, input-oriented, per-contact state machine (`flow_runs`), suspends at `send_buttons/send_list/collect_input` and `wait`.
- **Automation engine:** workflow-oriented, event-oriented, stateless per trigger but supports `wait` suspension via `automation_pending_executions` and branches via `automation_steps.parent_step_id`.

**Do NOT merge engines.** They share: ChannelSocket, pending execution table, taxonomy, trigger-channel snapshot pattern. Keep separate persistence.

**One product surface:** `/automations` and `/automations/[id]` canonical. Legacy `/flows` routes redirect into same experience. The taxonomy `src/lib/automations/unified-taxonomy.ts:1` provides one picker mental model (`communication|input|logic|timing|crm|integration|control`) while persistence stays distinct.

### 2.3 Lifecycle — Draft → Validate → Test → Publish → Active → Paused → Archived

| Transition | Trigger | What happens to active/waiting runs | Future contacts |
|-----------|---------|-------------------------------------|-----------------|
| **Draft → Validate** | Activate / Set Live | none yet | — |
| **Validate → Test** | Test with contact / Preview | not applicable (draft) | — |
| **Validate → Publish** | Publish passes validation (no `error` severity issues) | — | — |
| **Publish → Active** | `is_active=true` / `flows.status=active` | New runs get new definition; waiting runs stay on snapshot they were enqueued with (their `next_node_key`/`next_step_position` + `vars` snapshot) | Follow new definition |
| **Active → Paused (Draft)** | Toggle draft (`is_active=false` / `status=draft`) | **Waiting contacts remain at current step** (HighLevel verified; matches ConvoxOS wait table behavior). No migration of pending rows. | No new enrollments |
| **Paused → Active** | Re-publish | Same waiting preservation | Resume enrollments |
| **→ Archived** | Archive | Active runs remain until completed/failed; no new enrollments | None |

**Editing active automation (critical):** Existing waiting executions remain on old node/branch/wait/channel captured at enqueue time. Changing a node's target or wait duration does NOT retro-execute already-enqueued rows. New enrollments use new graph. If graph change removes a node that waiting executions point to, those executions fail with `node_not_found` on resume (visible error, not silent). This matches HighLevel "waiting remain at current step" and ManyChat "recipient list frozen at send-time" philosophy.

### 2.4 Enrollment & Re-entry

- **Flows:** One active run per `(account_id, contact_id, flow_id)` (migration `044` UNIQUE). Different flows can wait for same contact concurrently (TG flow + WA flow). Keyword/first_inbound triggers evaluated per inbound; channel-aware resume matches `trigger_channel` first then `reply_id`.
- **Automations:** Multiple automations can fire for same `accountId+triggerType` per event (loop in `engine.ts`). `tag_added` chains guarded by `MAX_TAG_CHAIN_DEPTH`. No automatic duplicate suppression for same contact re-entering same automation on same event — caller must deduplicate via condition (e.g., tag already present) or re-entry will produce multiple logs. `PENDING` wait rows are per-execution (no dedup). Future P2: add explicit re-entry guard (tag presence) docs.
- **Sequences (ManyChat parity target, P2):** Subscribing to already-subscribed sequence = no-op? ManyChat behavior not verified; mark `UNCERTAIN` for ConvoxOS target: subscribing twice while still enrolled re-enrolls from start only if `re-enroll` flag set.

### 2.5 Execution States

**Persisted run status (`flow_runs.status` / `automation_logs.status`):**

- `active` — awaiting input or timer (Flows) / `partial` (Automations wait enqueued)
- `waiting` — logical alias for active at a suspend node (shown as Waiting in stats)
- `completed` / `success` — reached end naturally
- `handed_off` — via `handoff` node or fallback exhaustion
- `failed` — hard error (send failed, node_not_found, channel_target_missing, validation)
- `timed_out` — swept after `fallback_policy.on_timeout_hours` (Flows) — not yet enforced by cron; target P1
- `paused_by_agent` — human intervention (Flows)
- `cancelled` — via `Remove from Workflow` equivalent (not yet; P2)

**Stats view:** per-trigger Attempted/Matched/Unmatched (GHL), per-node Overall/Waiting/Passed/Failed (ManyChat Smart Delay), per-communication Delivered/Read/Replied (already in broadcasts). ConvoxOS target: 30-day window for trigger stats, editing disabled in stats view.

### 2.6 Triggers — Target Catalog

**Current ConvoxOS (8):** `new_message_received, first_inbound_message, keyword_match, new_contact_created, conversation_assigned, tag_added, time_based, interactive_reply` (per `src/types/index.ts:465` + `src/lib/flows/types.ts:220` keyword/first_inbound/manual).

**Target (HighLevel parity + ManyChat parity, P0–P2):**

- **P0 (foundation):** Keep existing; add `channel: any|whatsapp|telegram` filter already present (`trigger_config.channel`) — verified correct.
- **P1 (core CRM):** `contact_created`, `contact_changed` (field whitelist), `contact_tag` alias for `tag_added`, `note_added`, `task_added` (requires task entity — see CRM spec), `customer_replied` (generic inbound irrespective of keyword), `form_submitted`, `inbound_webhook`, `scheduler` (time-based already but needs explicit type), `appointment_status`, `opportunity_created/status_changed/pipeline_stage_changed/stale` (requires opportunity/pipeline stage tracking), `conversation_assigned` already exists.
- **P2 (parity):** `email_events`, `call_details`, `video_tracking`, `number_validation`, `messaging_error_sms`, `funnel_pageview`, `quiz/survey_submitted`, `review_received`, `click_to_whatsapp_ads`, `facebook/instagram_comment`, `company_created/changed` (if B2B). Many require entities not present (calls, surveys, funnels) — mark optional.

Each trigger contract must define: event source, config schema, filter semantics, re-entry, channel scoping, payload availability for `send_webhook` (trigger-dependent).

### 2.7 Actions / Nodes — Target Set

**Current flows nodes (10):** `start, send_message, send_buttons, send_list, send_media, collect_input, condition, set_tag, wait, handoff, end` (+ `http_fetch` in DB CHECK but not runtime).

**Current automation steps (12):** `send_message, send_buttons, send_list, send_template, add_tag, remove_tag, assign_conversation, update_contact_field, create_deal, wait, condition, send_webhook, close_conversation`.

**Target taxonomy (Unified `src/lib/automations/unified-taxonomy.ts:46`):** `communication|input|logic|timing|crm|integration|control`. Validate: fits both products; no better taxonomy found in research. Keep it.

**Missing nodes for parity (P1–P2):** Randomizer/Split (up to 6 branches, sticky vs every-time), Goal (skip-ahead), Sequences/Broadcasts as domain objects (subscribe/unsubscribe sequence — already Add/Remove Tag covers part but need first-class `Subscribe to Sequence`), Dynamic/External Request as full `Make External Request` action (exists as `send_webhook` — expand to GET/PUT/DELETE + headers template), Delay inside message (typing indicator) separate from Smart Delay, Update Opportunity / Move Stage (create_deal only covers create; need update/move), Add Note, Add Task (real task entity), Disable/Enable DND, Copy Contact, File/Card/Gallery dynamic blocks (channel-specific), Notify Assignees.

### 2.8 Preview / Testing / Publishing

- **Save:** allowed with incomplete graph (draft). Red dot unsaved state. `Saved ≠ Published` independent (HighLevel verified) — ConvoxOS should separate `saved` (has unsaved changes) from `is_active` (published).
- **Validate:** `validateFlowForActivation` / `validateStepsForActivation` run before activation; surface `ValidationIssue` with `severity error|warning` + `scope` + `field` + `node_key`. Publish blocks on `error` only; warnings allowed. Add per-node Incomplete state in builder.
- **Preview (quick, in-canvas):** Widget shows Text/Buttons/Quick Replies/Images/Delay/Card/Gallery/Audio/Video; hides Actions/Smart Delay/Start Automation/Goals; conditions manual; no contact/third-party data; no SMS/Email; input validation skipped; image upload not supported. Document limitations explicitly (ManyChat verified).
- **Preview (full, in-app):** `Test Workflow/Automation` → select contact → Run Test → executes entire workflow including channels, webhooks, integrations → Execution Logs `Executed`. ConvoxOS: reuse `POST /api/automations/engine` + `dry-run.ts:1` and extend to Flows; show per-step result log inline. Charges/logic same as live except isolated to test contact.
- **Publish:** `Set Live`/`Publish` toggle. Requires validation. Creates `last_executed_at` bump on first real run.
- **Version history:** Snapshot on each save (HighLevel parity P2). History icon → list versions → Back to Builder (restore creates new draft, not in-place rewrite of waiting runs).
- **Execution history:** Flow: `flow_run_events` already (started/node_entered/message_sent/reply_received/fallback_fired/handoff/timeout/error/completed). Automation: `automation_logs.steps_executed` already. Add per-trigger Attempted/Matched/Unmatched + Stats View toggle + 30-day window (P2).

### 2.9 Sequences & Broadcasts — Domain Objects

- **Sequences:** Distinct entity `sequences` (subscribed contacts + per-message enabled + delays per message + Send-between window). Actions `Subscribe to Sequence`/`Unsubscribe from Sequence` add/remove. Enrollment via button, bulk, or contact profile. Waiting semantics: Data Collection inside sequence message pauses 30 min; Smart Delay interleaves. ConvoxOS does not yet have sequences — P2.
- **Broadcasts:** Existing `broadcasts`/`broadcast_recipients` is template-based. Target: add audience segmentation (HighLevel-style conditions: gender/tags/name/activity/language/timezone/custom fields), channel selection, Send Now vs schedule (recipient list frozen at send time), channel-specific content. Keep `delivery_locked_at` anti-double-send already.

### 2.10 Channel Correctness

- Channel-neutral automation level; channel-aware authoring level (see `docs/specs/channel-capabilities.md`). Builder prevents invalid combinations before runtime. ChannelSocket stays thin.

## 3. Error Model — Classes & Contracts

| Class | Where detected | UI surface | Execution behavior | Retry/recovery |
|-------|---------------|------------|--------------------|----------------|
| **Configuration** (missing field) | validate* at save/publish | Inline highlight per `field`, publish blocked | N/A (never runs) | Fix then re-publish |
| **Graph** (dangling edge, unreachable, cycle, duplicate reply_id) | validate* at build; cycle DFS at publish | Warning/error badge per node | Failed run `node_not_found` / cycle safety_break | Edit graph |
| **Channel capability** (buttons≤3 on WA vs ≤10 TG, unsupported block) | builder hide + channel-aware validate at publish | Hidden option not shown; mismatched target → error | Runtime `capability_not_supported` / `send_media_failed` | Fix target or transform |
| **Channel target missing** | runtime `resolveChannelTarget` returns null | Node error `channel_target_missing` (already logged) | End run failed | Use explicit Current with snapshot or pick channel |
| **Provider** (Meta / Telegram API error) | ChannelSocket `ChannelSocketError` with code/status | Log `send_text_failed` + detail, stats Failed | End failed (Flow) / step failed then break (Automation) | No auto-retry; manual re-send or re-publish |
| **CRM** (contact not in account, field not writable, missing conversation) | engine guards + RLS | Log detail `cannot send: contact has no conversation` | Failed/log warning | Fix CRM state |
| **Integration** (webhook SSRF, URL not allowed, non-ok, timeout 10s) | `isDeliverableUrl` + fetch `manual` redirect + 10s timeout | Step failed detail | Step failed | Fix URL / external auth |
| **Timeout** (Smart Delay > wait, fallback on_timeout_hours) | sweep cron (future) | Timed_out state | End timed_out | — |
| **Retry exhaustion** (fallback reprompt max) | `fallback.ts:1` decideFallback | fallback_fired → handoff/end | handed_off/completed | — |
| **Partial** (wait suspend) | enqueue pending | partial log / waiting stat | Suspend, await timer/resume | Cron resumes |
| **Recovery** (wait enqueue failed) | insert error | error node | Failed run | Fix DB |

**No silent fallbacks. No hidden WhatsApp defaults.** Every class produces a log visible in automation log / flow run events.

## 4. Limits & Quotas

- Flow: ≤30 blocks without pause → auto-pause (ManyChat verified) — enforce as publish warning P1; runtime safety cap 64 iterations already in `engine.ts:694`.
- Randomizer ≤6 variations. Buttons ≤3 WA / ≤10 TG channels. Lists ≤10 rows. Button title ≤20, list row title ≤24, caption ≤1024 (already in `INTERACTIVE_LIMITS`).
- Tag chain depth `MAX_TAG_CHAIN_DEPTH` guard already.

## 5. What We Will NOT Build Yet (P4)

See roadmap P4: enterprise analytics beyond trigger/node stats, full AI builder, marketplace integrations beyond webhook, additional channels (Instagram/Messenger/SMS/Email), microservices/event bus/CQRS.

---
*Teams checklist: validate against `docs/research/manychat-model.md` + `highlevel-model.md` before any engine change.*
