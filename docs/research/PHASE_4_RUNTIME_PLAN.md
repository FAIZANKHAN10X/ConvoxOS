# Phase 4 Runtime Implementation Plan — Manychat-Style Execution

> **Status:** Planning only (pre-coding). Graphify inspected `flows/engine.ts`, `flow_runs`, `automation_pending_executions`, `channel socket`, `graph-service`, `edges`, `sequences`, `automation engine`.
> **Invariant:** Canonical graph remains ONLY source of truth (`flows` + `flow_nodes` + `flows.trigger_envelope` + `flow_runs` + `contact_randomizer_buckets`). No second engine, no second persistence, no second Message representation, no React-side runtime.

## 1. Architecture Decision

**Extend existing `src/lib/flows/engine.ts` (graph executor) as canonical runtime** — it already handles `flow_runs.current_node_key`, `flow_run_events`, `automation_pending_executions` pending, `ChannelSocket`, `Condition`, `Wait`, `Handoff`, `Fallback`, `isSuspending/isAutoAdvancing`, `findEntryFlow`, `handleReplyForActiveRun`. Automations engine (`src/lib/automations/engine.ts`) remains for legacy sequential compatibility but new trigger dispatch (`processNormalizedInbound.ts`) will call unified dispatcher that checks `trigger_envelope` OR first, then falls back.

Why not new engine: `flows/engine.ts` already implements `flow_runs` concurrency (`idx_one_active_run_per_flow`), `flow_run_events` idempotency, `automation_pending_executions` pending, and channel `current` snapshot — rebuilding would duplicate 500+ lines and risk divergence. Phase-1 `055` already added `flow_runs.pending_*` and `contact_randomizer_buckets` for unified needs.

## 2. Execution State Machine

Extend `flow_runs.status` + new `pending_kind` (already in `055`):

```
active ──send Message (no buttons)──▶ active (next)
active ──send Message (buttons/quick replies/DataCollection)──▶ active + pending_kind=dataCollectionTimeout? | waiting_for_input (current_node_key = message, awaiting reply_id)
active ──Smart Delay──▶ active + pending_kind=smartDelayDuration|Date, pending_until, pending_context{window, tz}
active ──Condition──▶ active (branch true_next/false_next)
active ──Randomizer──▶ active (variant next)
active ──Action──▶ active (next) — tasks sequential, non-blocking
active ──Start Automation──▶ active (callee sync flush, see §7)
active ──Handoff/End──▶ handed_off/completed
active ──error/missing target──▶ failed
active ──30 blocks without pause──▶ active + pending_kind=wait (auto-pause) — guarded
timed_out/paused_by_agent are swept by cron via fallback_policy.on_timeout_hours
```

`pending_context` stores `varsSnapshot, trigger_channel, resumeNodeKey, windowSpec, contactTz, callStack` for cross-restart recovery.

Cron: Reuse `src/app/api/flows/cron/route.ts` + `automation_pending_executions` `WHERE status=pending AND run_at <= NOW()` — already handles Flow Waits; extend to check `pending_kind` window re-evaluation before resume.

## 3. Implementation Steps (dependency-ordered)

### Step 1 — Trigger → Graph Execution (§1)
- Extend `findEntryFlow()` to handle `trigger_envelope` OR: iterate `flows` where `trigger_envelope->triggers` contains enabled trigger matching `UnifiedTriggerKind` + channel filter. Keyword priority `keywordPriority` order if provided, else first matching. No invented priority — first enabled matching wins (documented).
- Keep legacy `trigger_type` path for non-migrated rows.
- Entry remains `entry_node_id` (now `entry_node_key` semantics) — no hard-coded linear sequence.

### Step 2 — Message Container (§2)
- New handler `executeMessage(node: MessageContainerConfig, run, contact)`: iterate `content_blocks[]` in order.
  - `text|image|file|audio|video|pdf|card|gallery|messenger_list|dynamic` → `ChannelSocket.dispatch*` via existing `dispatchText/dispatchMedia/dispatchInteractive` (reuse, not duplicate). Unsupported block for channel → log `error` and `issues` via validator already, but runtime will skip block and continue (observable failure, not silent).
  - Count blocks for 30-block guard (each block = 1 block).
  - After all blocks sent, check if last block(s) have `buttons[]` or `choices[]` (data_collection) → suspend: `flow_runs.current_node_key = node_key`, `pending_kind=null` (waiting_for_input), return `suspended` not `completed`. Resume via `matchReplyId()` over `content_blocks` buttons (reuse existing `matchReplyId` extended for message container).
- Important: content_blocks are NOT top-level nodes — loop inside one node execution.

### Step 3 — Data Collection (§3)
- `data_collection` block inside Message that expects free-text / choice / file: suspend as above, but also handle free-text capture (no buttons): `pending_kind=dataCollectionTimeout`, `pending_until = NOW+30min`, store `var_key` in pending_context. On resume, validate reply type (for choice, must match `choices[].reply_id`; for free text, capture `message.text` trimmed into `vars[var_key]` via `interpolateVars` already).
- Persist via `flow_runs.pending_*` (not memory).

### Step 4 — Smart Delay (§4)
- Handler `executeSmartDelay(node)`: compute `resumeAt`:
  - `duration`: `now + amount*unit`; if `window.continueBetween` → align to next window occurrence in contact TZ else account TZ (use `pending_context.contactTz` stored at suspend).
  - `date specific`: `datetime`; `dynamic`: `CUF_DateField value ± offset`.
  - Max 365d via validator already.
- Insert `automation_pending_executions {flow_run_id, run_at=resumeAt, pending_kind, context{resumeNodeKey, windowSpec}}` and set `flow_runs.pending_kind=smartDelayDuration|Date, pending_until=resumeAt`.
- Resume checks window again (if missed window due to restart, re-enqueue to next window).

### Step 5 — Condition (§5) & Randomizer (§6)
- Condition: `evaluateConditionNode()` extended for `match all|any` + 12 subjects (tag, widget, etc.) but Phase 4 implements core verifiable: `var|tag|contact_field|tag_presence|message_content|time_of_day` already in `evaluateConditionPredicate` + `ALL/ANY` already in `src/lib/flows/types.ts:158` `conditions[] match`. Select `true_next/false_next`.
- Randomizer: `variants[] weight` sum 100 (validated). Sticky: `SELECT contact_randomizer_buckets WHERE account,contact,flow,node_key` → if exists reuse variant_id else pick weighted random (respect weight), `INSERT` bucket. Every-time random skips bucket. Document sticky choice.

### Step 6 — Start Automation (§7) + 30-Block Guard (§8)
- Start Automation: `executeStartAutomation(node, callStack)`: recursion guard `callStack.length > 5` (safe platform guard, document as 5 not Manychat-verified) → `failed`. Load callee via `supabaseAdmin flows+flow_nodes where id=callee_flow_id`. Execute callee graph synchronously in same DB transaction context: loop callee nodes, flush `message` blocks (send), but **skip suspension** for callee buttons/quick replies (if callee message has buttons, send it but do not suspend — immediately continue to callee's next). After callee completes (reaches end/handoff), return to parent `next_node_key`. Persist callStack in `flow_runs.pending_context.callStack` for crash recovery.
- 30-block guard: in `advanceFromNodeKey` loop, counter `blocksWithoutPause` increments for `isAutoAdvancing` nodes, resets on `isSuspending` or `smart_delay`. If `>=30` before next auto node, insert auto-pause as `smart_delay` 0-wait (or set `pending_kind=wait` with `pending_until=now` and `pending_context.autoPaused=true`) and pause — resume immediately on next cron tick. This is runtime guard, not node-count limit.

### Step 7 — Action Runtime (§13)
- `executeAction(node)`: iterate `tasks[]` in order, dispatch via existing CRM adapters (`addContactTagAndDispatch`, `updateContactField` via `contact_custom_values`, `deleteContact`, `setChannelOptInOut`, `setBotField`, `subscribeSequence`, `makeExternalRequest` via `fetch` with 10s timeout, `changeMenu` if Messenger, `logConversion`, `markConversation`, `assignConversation`, `notifyAssignees`, `sendCapi`). Reuse `src/lib/automations/engine.ts` task handlers where applicable, but call from unified engine, not second engine. One Action node = one graph node, tasks sequential within node execution (count as 1 block for 30-guard? No, each task not block — Action node is 1 block).

### Step 8 — Errors, Idempotency, Delivery, Legacy Cutover
- Errors: unsupported block, missing `next_node_key` target deleted, missing callee, delivery `ChannelSocketError` → `logEvent(error)` + `endRun(failed)` with observable `end_reason`.
- Idempotency: reuse `flow_run_events` dedup `isDuplicateInbound` (payload meta_message_id) for inbound; for resume, `automation_pending_executions` `WHERE status=pending AND run_at<=now() FOR UPDATE SKIP LOCKED` (existing cron already does) ensures single resume. Message delivery idempotency via `flow_run_events event_type=message_sent` check before resend on retry.
- Channel: `graph semantics → content block → channel adapter` — runtime calls `socket.dispatch*` which already handles WhatsApp/Telegram branching; no duplicated transport.
- Legacy cutover: `processNormalizedInbound` currently calls both `dispatchInboundToFlows` and `runAutomationsForTrigger`. For Phase 4, unified dispatcher checks `trigger_envelope` first; if flow matches, it handles; else fall through to legacy automations. Read path (`GET /api/automations/[id]/logs`) will merge `flow_run_events` + `automation_logs` later — not in Phase 4. Document as compatibility boundary if not safe to cutover writes.

## 4. Blockers Found

- None blocking. `055` pending columns + `contact_randomizer_buckets` already land required persistence. Channel layer already abstracted. No new waiting-state table needed.

## 5. What This Plan Does NOT Do (strict Phase 4 boundary)

- AI Step deep runtime, analytics redesign, Sequences redesign, Dynamic beyond safe execution, Messenger List/Card/Gallery deep runtime beyond minimum to avoid breaking Message model, preview UI, microservices/Kafka.

