# Automation Unification Migration Plan — Phase 0 Frozen Audit

> **Status:** Phase 0 — frozen audit + migration safety. No Phase 2+ behavior.
> **Source of truth:** `docs/research/MANYCHAT_PRO_FLOW_BUILDER_SPEC.md` + `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md` (approved: Manychat is target, existing Convox is starting point not constraint).
> **Graphify basis:** `graphify-out/graph.json` re-queried 2026-09-02 for every table/engine/route below; file citations `path:line`.
> **Git baseline:** `main` ahead of `origin/main` by 8 commits at `053f957` baseline; untracked `docs/research/MANYCHAT_*` + `graphify-out/` only diff.

---

## 1. Existing Data — Frozen Inventory

### 1.1 `automations` — sequential automation store

**Migration file:** `supabase/migrations/006_automations.sql:14`
**Type:** `src/types/index.ts:736` `Automation`
**Columns:**
```
id UUID PK DEFAULT gen_random_uuid()
user_id UUID FK auth.users ON DELETE CASCADE
account_id UUID FK accounts (via 017_account_sharing.sql backfill, NOT NULL post-017)
name TEXT NOT NULL
description TEXT NULL
trigger_type TEXT NOT NULL  // AutomationTriggerType enum: 15 values at src/types/index.ts:482
trigger_config JSONB NOT NULL DEFAULT '{}'
is_active BOOLEAN DEFAULT FALSE
execution_count INTEGER DEFAULT 0
last_executed_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()  // trigger set_updated_at
```
**Indexes:** `idx_automations_user_id(user_id)`, partial `idx_automations_active_trigger(trigger_type) WHERE is_active`
**RLS:** `ENABLE ROW LEVEL SECURITY`; policy `"Users can manage own automations" USING (auth.uid()=user_id)` PLUS account scoping via `account_id` in engine queries (`src/lib/automations/engine.ts:110` `runAutomationsForTrigger` verifies contact ownership by account_id).
**Migrations 017+:** `account_id` made NOT NULL, `auth.users` → `accounts` tenancy migrated; `api_keys` tenancy etc. but automations still has `user_id` as secondary.
**Data volume (prod snapshot via graphify):** Not material to migration; treat as O(thousands).

### 1.2 `automation_steps` — position + branch tree

**Migration:** `006_automations.sql:53`
**Type:** `src/types/index.ts:756` `AutomationStep`
```
id UUID PK
automation_id UUID FK automations ON DELETE CASCADE
parent_step_id UUID FK automation_steps ON DELETE CASCADE  // NULL = root
branch TEXT CHECK IN ('yes','no')  // only for children of Condition (parent_step_id set)
step_type TEXT NOT NULL  // AutomationStepType 18 values at src/types/index.ts:505
step_config JSONB NOT NULL DEFAULT '{}'
position INTEGER NOT NULL  // order within parent scope (root or branch)
created_at TIMESTAMPTZ
```
**Indexes:** `(automation_id, position)`, partial `parent_step_id WHERE NOT NULL`
**RLS:** Through parent `EXISTS (SELECT 1 FROM automations a WHERE a.id=automation_id AND a.user_id=auth.uid())`
**Builder adapter:** `src/lib/automations/builder-tree.ts:1` `TreeStep` + `src/lib/automations/automation-editor-adapter.ts:39` `stepsToNodes()/nodesToSteps()` — already translates this tree into graph-like nodes for editor. Evidence: graph edge `builder-tree.ts → automation-builder.tsx`.
**Step catalog:** 18 types covering `send_message, send_buttons, send_list, send_template, add_tag, remove_tag, assign_conversation, update_contact_field, create_deal, create_task, randomizer, goal, enroll_in_sequence, wait, condition, send_webhook, close_conversation`. Superset of flows’ 13 but missing `message container` semantics — `send_buttons/send_list` are flat distinct types not content blocks.

### 1.3 `automation_logs` — history

**Migration:** `006_automations.sql:87`
```
id, automation_id FK CASCADE, user_id, contact_id FK contacts SET NULL, trigger_event TEXT, steps_executed JSONB DEFAULT '[]' (array of {step_id, step_type, status success|skipped|failed, detail?}), status IN (success,partial,failed), error_message TEXT, created_at
```
**Retention:** `ON DELETE CASCADE` for automation, `SET NULL` for contact — history survives contact deletion (pattern `004`).

### 1.4 `automation_pending_executions` — wait queue (shared by both engines)

**Migration:** `006_automations.sql:119`
```
id, automation_id FK CASCADE, user_id, contact_id SET NULL, log_id FK automation_logs, parent_step_id SET NULL, branch yes|no, next_step_position INTEGER NOT NULL, context JSONB DEFAULT '{}', status IN (pending,running,done,failed), run_at TIMESTAMPTZ
```
**Index:** partial `run_at WHERE status=pending` for cron `src/app/api/automations/cron/route.ts:19` `resumePendingExecution()` / `src/lib/automations/engine.ts:212`.
**Dual use:** Flows `wait` also inserts here (`src/lib/flows/engine.ts:915` waitMs → inserts `automation_pending_executions {flow_run_id, run_at}` reusing same table with `automation_id = flow_id` overload — architectural debt).

### 1.5 `automation_versions` + `automation_trigger_evaluations`

- `050_automation_versions.sql:4`: version snapshots per automation (not inspected deeply this pass — treat as historical snapshots, preserved read-only).
- `051_trigger_evaluations.sql:4`: per-trigger evaluation diagnostics — keep read-only.

### 1.6 `flows` envelope + `flow_nodes` graph

**Migration:** `010_flows.sql:77` flows, `010_flows.sql:114` flow_nodes
```
flows:
  id, user_id FK users CASCADE, account_id (post-017, reuse flows.user_id tenancy), name TEXT, description, status IN (draft,active,archived) DEFAULT draft, trigger_type IN (keyword,first_inbound_message,manual), trigger_config JSONB, entry_node_id TEXT (→ flow_nodes.node_key, NULL while drafting), fallback_policy JSONB, execution_count, last_executed_at, created_at, updated_at

flow_nodes:
  id, flow_id FK flows CASCADE, node_key TEXT NOT NULL (stable string e.g. "menu_existing", not UUID — enables cloning without edge rewriting), node_type IN (start, send_buttons, send_list, send_message, collect_input, condition, set_tag, handoff, http_fetch, end) — 10 types at L118, UNIQUE(flow_id, node_key), config JSONB, position_x/y INTEGER DEFAULT 0
```
**Edges-in-config** reasoning at `010_flows.sql:8` — each button row carries `next_node_key`, condition has `true_next/false_next`, etc. Integrity enforced at save-time by `src/lib/flows/validate.ts:52` (`outgoingEdges L978`). No separate `flow_edges` table — single-row lookup per inbound.
**RLS:** flows `auth.uid()=user_id`, flow_nodes `EXISTS (SELECT 1 FROM flows f WHERE f.id=flow_id AND f.user_id=auth.uid())`.

### 1.7 `flow_runs` + `flow_run_events` — per-contact state machine

**Migration:** `010_flows.sql:156` flow_runs, `L216` flow_run_events
```
flow_runs:
  id, flow_id FK, user_id, contact_id SET NULL, conversation_id SET NULL, status IN (active,completed,handed_off,timed_out,paused_by_agent,failed) DEFAULT active, current_node_key TEXT, last_prompt_message_id UUID→messages, vars JSONB, reprompt_count INT, started_at, last_advanced_at, ended_at, end_reason TEXT
  Partial unique idx_one_active_run_per_contact ON (user_id, contact_id) WHERE status=active  // concurrency safety L189
  Indexes on last_advanced_at WHERE active (cron sweep) + (flow_id, started_at DESC) for history page

flow_run_events:
  id, flow_run_id FK CASCADE, event_type IN (started,node_entered,message_sent,reply_received,fallback_fired,handoff,timeout,error,completed), node_key, payload JSONB, created_at
  Indexes on (flow_run_id, event_type) for idempotency + (flow_run_id, created_at DESC) for history viewer
```
**Engine:** `src/lib/flows/engine.ts:1` `dispatchInboundToFlows() L1140 → findEntryFlow() L386 → advanceFromNodeKey() L733` loop over `isSuspending() L154 / isAutoAdvancing() L142 / isTerminal() L175`. Active run per contact ensures at-most-one flow per contact.

### 1.8 Other automation-related persistence (preserve, not migrate)

- `tasks (047)`, `sequences (049: sequences + sequence_steps + sequence_enrollments)`, `contacts/contact_notes/contact_tags/custom_fields/contact_custom_values`, `tags`, `conversations/messages` (including `interactive_reply_id`), `broadcasts/broadcast_recipients`, `webhook_endpoints (028)`, `quick_replies (035)` — keep as referenced entities, not migrated into graph.

---

## 2. Target Data — Canonical Unified Automation Graph

Per architecture plan `§5.1`, but restated here as migration target contract.

### 2.1 Canonical tables (post-Phase 1)

```
flows  (retained as canonical table; product renamed "Automations" in UI, table stays flows for data-preservation — alias view automation_graphs)
  id                                // preserved UUID
  account_id                        // already post-017
  user_id                           // audit, not tenancy
  name, description, status draft|active|archived  // unchanged semantics; add archived soft-delete preserved
  trigger_envelope JSONB             // NEW — replaces single trigger_type/trigger_config as primary
     { triggers: [{id:string, kind:AutomationTriggerType|+new Manychat kinds (instagram_comments, facebook_comments, story_reply etc.), channel?:any|whatsapp|telegram, config:TriggerConfig, enabled:boolean }] }
  trigger_type, trigger_config       // KEPT as legacy compat (generated or adapter-populated from trigger_envelope[0] for rollback)
  entry_node_key TEXT                // renamed from entry_node_id semantics clarified → entry_node_key (FK → flow_nodes.node_key) — keep column name entry_node_id for compat, add alias
  fallback_policy JSONB              // keep
  execution_count, last_executed_at, created_at, updated_at, version INT, stats_snapshot JSONB NULL

flow_nodes
  id, flow_id, node_key UNIQUE(flow_id,node_key), node_type IN (message, action, condition, randomizer, smart_delay, start_automation, ai_step, handoff, end, ... legacy compat), config JSONB (discriminated union per §5.1 architecture plan), position_x, y

flow_runs  (extend, not replace)
  add pending_kind enum wait|smartDelayDuration|smartDelayDate|dataCollectionTimeout|aiTurn|null
  add pending_until TIMESTAMPTZ
  add pending_context JSONB {resumeNodeKey, windowSpec?, contactTzElseAccount?, varsSnapshot, conversationId, cUFDateFieldId?, offset?}

contact_randomizer_buckets  (NEW)
  id, account_id, flow_id, node_key, contact_id, variant_id, assigned_at, UNIQUE(account_id,contact_id,flow_id,node_key)

preview_sessions  (NEW, Phase 1 scaffold — optional)
  id, account_id, flow_id, mode inmanychat|inmessengers, created_by_user_id, state JSONB, masked boolean

automation_pending_executions
  keep as resume queue; extend context to {flow_run_id?, resumeNodeKey, trigger_channel_snapshot, vars, windowSpec} so Smart Delay window can be re-checked on cron resume
  add flow_run_id FK nullable for flows-origin waits (today overloads automation_id = flow_id)

legacy automations + automation_steps
  NOT dropped in Phase 1. Made read-only compat (RLS SELECT only) and exposed via view v_automation_graphs that recomputes nodes via import. Dropped only after bake-out.

Views for compat (Phase 1, temporary):
  v_legacy_trigger AS SELECT id, trigger_type, trigger_config FROM flows WHERE trigger_envelope IS NULL
  v_automation_graphs — unified read view that outer Code can query regardless of old/new storage
```

### 2.2 Why evolve `flows`/`flow_nodes` rather than new table

- `flow_nodes.node_key` stable-string edges-in-config is already Manychat-like (§3 feedback: Graphify shows 10 node types; flows model matches spec §6 Message container reasoning).
- `flow_runs` concurrency safety `idx_one_active_run_per_contact` is verified load-bearing for Manychat per-contact execution.
- `flows` is younger than `automations` but more structurally correct for graph target; evolving it costs one enum expansion + one JSONB column + two new tables vs migrating 2× tables in new schema + RLS + realtime publication.
- `automations` rich trigger catalog and CRM action configs are merged *into* flow_nodes node types/trigger envelope — no data loss, adapter reuse `src/lib/automations/automation-editor-adapter.ts:39`.

---

## 3. Migration Strategy — OLD → TRANSFORM → NEW CANONICAL GRAPH

### 3.1 Overall flow

```
For every row in automations:
  READ: automation {trigger_type, trigger_config, name, description, is_active, created_at} + automation_steps {step_type, step_config, position, parent_step_id, branch}
    ↓
  TRANSFORM: stepsToGraphImport()  (extends src/lib/automations/automation-editor-adapter.ts:39)
    ↓
  WRITE: single flows row {name, trigger_envelope{triggers:[{kind: mappedFrom automation trigger_type, channel: trigger_config.channel?, config: mapped}]} , status: is_active?active:draft, entry_node_key: first node_key derived, created_at preserved} + N flow_nodes {node_key: step_id or slugified stable key, node_type: mapped, config: mapped} + edges derived from position/branch/button/row bindings
    ↓
  VERIFY: validateAutomationForActivation({triggerEnvelope, nodes}) reports no error for migrated graph that had no error before; orphan/dangling counts equal before/after
    ↓
  LEAVE: original automations row read-only (is_active forced false, name suffixed " [migrated]" optional flag) — not deleted
    ↓
For every row in flows (already graph):
  READ: flows {trigger_type, trigger_config, entry_node_id} + flow_nodes[]
    ↓
  TRANSFORM: trigger_type→trigger_envelope uplift (single trigger wraps); legacy flat node types send_message/send_buttons/send_list/send_media → message{content_blocks[]} one-liner per node (case: single ContentBlock per old node); collect_input stays; set_tag → action{tasks:[add_tag]}; wait stays but gain pending window shape; randomizer stays; handoff/end unchanged
    ↓
  WRITE: backfill flows.trigger_envelope, keep nodes in place but rewrite config for affected node_types (in-place upgrade within same flow_nodes rows, new node_keys preserved)
    ↓
  VERIFY: graph retrieval round-trip stable (nodes+edges+triggers idempotent)
```

### 3.2 Field mapping — metadata

| Old `automations` field | Old `flows` field | New canonical `flows` field | Transform |
|-------------------------|-------------------|-----------------------------|-----------|
| `id` | `id` | `id` preserved (no new UUID) | Copy verbatim |
| `user_id` (`auth.users`) | `user_id` | `user_id` audit + `account_id` tenancy | Copy; derive `account_id` from `profiles.account_id` if NULL via `auth.users` join (017 backfill pattern) |
| `name` | `name` | `name` | Copy |
| `description` | `description` | `description` | Copy (flows.description already nullable) |
| `is_active` boolean | `status draft|active|archived` | `status` | `is_active=true → status=active` else `draft`; `archived` preserved if flows already had it |
| `execution_count` | `execution_count` | `execution_count` | Copy |
| `last_executed_at` | `last_executed_at` | `last_executed_at` | Copy |
| `created_at / updated_at` | `created_at / updated_at` | `created_at / updated_at` | Preserve original values (INSERT with explicit timestamps, trigger set_updated_at will bump updated_at — override with `SET updated_at = OLD.updated_at` after insert) |
| (none) | `fallback_policy` | `fallback_policy` | Default `{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}` for imported automations (from `src/lib/flows/types.ts:333` `DEFAULT_FALLBACK_POLICY`) |

### 3.3 Node mapping

| Old concept | New graph `flow_nodes.node_type` | New `config` | Notes |
|-------------|----------------------------------|--------------|-------|
| `automation_steps.position` order | implicit ordering replaced by explicit edges | — | `position` not needed after graph; `next_node_key` derived from `position+1` within same parent scope, branching uses child parent_step_id |
| `send_message {text, channel_target?}` | `message {channel_target, content_blocks:[{kind:text, text, buttons?}]}` | `content_blocks=[{kind:text, text}]` | One-liner |
| `send_buttons {kind buttons + InteractiveMessagePayload}` | `message {content_blocks:[{kind:text, text, buttons:[{reply_id,title,next_node_key}]}]}` | Each `button.reply_id → next_node_key` becomes Message inner button edge (Phase 3 completes multi-block, but Phase 1 wraps as single content_block with buttons). Channel-aware WA 3 vs TG 10 emitted as config limits. | Requires deriving `next_node_key` per button from sequential position unless branch already encoded (legacy interactive_reply trigger chaining across automations — see action mapping note). |
| `send_list {kind list}` | `message {content_blocks:[{kind:text-as-body, text, listSections: sections[].rows[].next_node_key }]}` | Similar but spec gallery vs list nuanced — keep sections shape inside content_blocks. | Until Message multi-block lands (Phase 3), single block suffices for validation parity. |
| `send_media {media_type, media_url, caption, filename}` | `message {content_blocks:[{kind:mediaKind, url:media_url, caption, filename}]}` | One content_block per old node | Preserves URL/caption |
| `send_template {template_name, language, variables}` | `message {content_blocks:[{kind:text-as-templateLegacy, template_name}]}` in Phase 1 migration (keeps WA-only template parity with locked `whatsapp` channel_target). Phase 3 may separate but retain here as compatibility. | | |
| `collect_input {prompt_text, var_key, validation, regex, next_node_key}` (flows `collect_input`) | `message {content_blocks:[{kind:data_collection, prompt_text, var_key, ...}]}` OR retain `collect_input` node_type as legacy-compat during Phase 1 — keep `collect_input` enum alias to `message+data_collection` until Phase 3 fully unifies | Keep enum value `collect_input` allowed for Phase 1 (no break); new graphs use message container but old reads still valid. |
| `condition {subject, operand?, value?, conditions?, match?}` with `parent_step_id+branch yes/no` tree | `condition {match, conditions:[], true_next, false_next}` | `true_next` = first child `branch=yes` `position 0` node_key, `false_next` = `branch=no`; multi-condition `conditions[]+match all|any` already typed in `src/types/index.ts:702` | |
| `add_tag {tag_id} / remove_tag {tag_id}` | `action {tasks:[{kind: add_tag|remove_tag, tag_id}], next_node_key}` | One Task per old step; sequential tasks that were separate steps become single file but Phase 1 keeps one node per step and then Phase 3 merges consecutive add_tag/remove_tag aggregates optionally | Preserve execution semantics (each node does one tag op then advance). |
| `update_contact_field {field, value}` | `action {tasks:[{kind: set_user_field, field_id: field, value}]}` | field `custom:<id>` vs built-in maps verbatim |
| `create_deal {pipeline_id, stage_id, title, value?}` | `action {tasks:[{kind: create_deal, ...}]}` | Copied verbatim |
| `create_task {title, description?, due_at?, assigned_to?}` | `action {tasks:[{kind: create_task}]}` | — |
| `randomizer {variants[{id,label,weight}], mode sticky|random}` | `randomizer {variants[{id,label,weight,next_node_key}], mode}` | `next_node_key` derived from position+1 mapping; sticky bucket table not yet backfilled (no history loss) |
| `enroll_in_sequence {sequence_id}` | `action {tasks:[{kind: subscribe_sequence}]}` | — |
| `wait {amount,unit,until}` | `smart_delay {kind: duration (amount,unit) or date (until), window: none, next_node_key}` | Populate smart_delay duration/date shape; `window: none` initially |
| `send_webhook {url, method?, headers?, body_template?}` | `action {tasks:[{kind: make_external_request, method, url, headers, body_template}]}` | — |
| `goal {condition, timeout_hours?, target_step_position?}` | `condition { ... } + smart_delay-like wait` OR keep `goal` enum alias for Phase 1 (flagged) | Keep `goal` node_type as compat; unify to condition+wait in Phase 4 |
| `assign_conversation / close_conversation` | `action {tasks:[{kind: assign_conversation/mark_conversation}]}` | — |
| Flows `start, set_tag, handoff, end, http_fetch` | `start → retained as legacy start alias`, `set_tag → action addTag single`, `handoff`/`end` kept, `http_fetch → action make_external_request` alias | Keep as compat enum values for Phase 1; new canonical uses `action`/`message`/etc. but validator must accept old enum during transition |
| `wait` (flows) | `smart_delay` | Same as automation wait above |

**Node keys:** Preserve `automation_steps.id` as `flow_nodes.node_key` where feasible after slugify (stable string requirement per `010_flows.sql:25`). For automation import, generate `node_key = slugify(step_type + "_" + position + "_" + id.slice(0,6))` — deterministic, idempotent. For flows existing, keep `node_key` verbatim.

### 3.4 Trigger mapping

| Old trigger (`automations.trigger_type` 15 values) | New `trigger_envelope.triggers[0].kind` | Config transform |
|----------------------------------------------------|----------------------------------------|------------------|
| `keyword_match {keywords[], match_type exact|contains|word, case_sensitive?, channel?:any|whatsapp|telegram}` | `keyword_match` same shape | Copy verbatim; `channel` preserved; `match_type word` stays (vs flows substring-only gap documented) |
| `new_message_received` (alias for customer_replied with no filter) | `customer_replied` | map — both inbound any message trigger, For Phase 1 keep `new_message_received` as alias enum |
| `first_inbound_message` | `first_inbound_message` | Copy |
| `tag_added {tag_id}` | `tag_added` | Copy |
| `time_based {schedule, timezone?}` | `time_based` (ManyChat Date/Time analog) | Copy |
| `interactive_reply {reply_ids[], channel?}` | `interactive_reply` | Copy |
| `contact_changed {field, value?}` | `contact_changed` | Copy |
| `note_added / task_added {}` | `note_added`/`task_added` | Copy empty `Record` |
| `customer_replied {channel?}` | `customer_replied` | Copy |
| `opportunity_created {pipeline_id?, stage_id?}` | `opportunity_created` | Copy |
| `pipeline_stage_changed {pipeline_id?, from_stage_id?, to_stage_id?}` | `pipeline_stage_changed` | Copy |
| `inbound_webhook {path?}` | `inbound_webhook` | Copy |
| `conversation_assigned / new_contact_created` | `conversation_assigned` / `new_contact_created` | Copy |
| Flows `keyword {keywords[], match_type?, case_sensitive?, channel?}` | `keyword_match` | Map `keyword → keyword_match` (flows case: `exact|contains` only, no `word` variant) |
| Flows `first_inbound_message {channel?}` | `first_inbound_message` | Copy |
| Flows `manual {}` | `manual` | Copy (Manychat Starting Step envelope requires manual as envelope-only) |

**Multiple triggers:** Old single-trigger automations map to `triggers: [mappedOne]`. New spec §5.3 allows ≥1 — Phase 1 persistence already supports array, validation allows 1..N, runtime OR dispatches (`Trigger A ∨ B ∨ C → first graph node`). No duplication of automation rows.

### 3.5 Edge mapping

| Old edge representation | New edges | Transform |
|------------------------|-----------|-----------|
| `automation_steps.position` implicit `next = position+1` within same parent scope | `config.next_node_key` explicit per node (or `variants[].next_node_key`, `buttons[].next_node_key`, `true_next/false_next`) | Derive: `next_node_key = nodeKeyOf(position+1 within same parent)` else `NULL` if terminal. For `condition` parent→children, use first child per branch as `true_next/false_next`. |
| `parent_step_id+branch yes/no` children | Condition 2-output edges | Already above |
| flows `*_next`/`buttons[]`/`sections[][]`/`variants[]` inside config | Keep as canonical edges-in-config (Phase 1 not yet Message container — keep flow_nodes edges-in-config verbatim; during migration of flows to new enum retain edges verbatim) | No rewriting needed |
| `entry_node_id` pointer | `entry_node_key` | Copy `entry_node_id → entry_node_key` verbatim (both are node_key strings, not UUID) |
| `flow_runs.current_node_key` runtime pointer | Same | Preserved — no migration of active runs required; old runs continue pointing at same node_key |

### 3.6 Action/condition/delay metadata

- **Validation status:** Old published automations (`is_active=true` or `flows.status=active`) are re-validated after migration via `validateAutomationForActivation()` — if migrated graph is `error`-free but warnings exist (e.g., channel mismatch `will never trigger`), promote to `active` preserved; if errors (dangling edge derived from bad position), downgrade to `draft` and flag for manual fix (never auto-fix dangling by deleting).
- **Tags/custom fields/sequences referenced by `tag_id/field/sequence_id`:** Preserved verbatim — no dereference; existence checked only at validate time (`EXISTS tag WHERE id=tag_id`). Deletion of referenced tag after migration surfaces as validation error as before.
- **Timestamps:** `created_at` preserved from original `INSERT`; `updated_at` preserved via `UPDATE flows SET updated_at = OLD.created_at` after import to avoid bump.

### 3.7 IDs / ownership / tenant

| Concern | Handling |
|---------|----------|
| `id` generation | Preserve original UUID (`INSERT flows(id,...)`) — not regenerated |
| `account_id` | Copy from `automations.account_id` or derive from `flows.user_id→profiles.account_id` if missing (017 backfill pattern); NOT NULL post-Phase 1 |
| `user_id` | Preserve audit originator |
| RLS | Already `ENABLE ROW LEVEL SECURITY` on `flows`/`flow_nodes`/`flow_runs`; updated RLS after column add retains `USING (auth.uid()=user_id)`; no weakening. |
| Soft-delete | No hard delete — flows `status=archived` mirrors automations `archived` concept; legacy automations rows set `is_active=false` + flag `description = description || ' [migrated to flows.id: '||new_id||']'` — not deleted. |

### 3.8 Existing execution history

| History table | Migration decision | Rationale |
|---------------|-------------------|-----------|
| `automation_logs` (success|partial|failed, steps_executed[]) | **Preserve read-only, not migrated** — keep table + RLS. New history writes go to `flow_run_events` for unified runs; old logs remain queryable via `GET /api/automations/[id]/logs` alias that merges `automation_logs` + `flow_run_events` by creation date. |
| `flow_runs` + `flow_run_events` | **In-place** — already canonical per spec §1.3; no migration, extended columns only (pending kind). History continues to query same tables. |
| `automation_pending_executions` rows with `status=pending` | **Keep pending, repoint** — `run_at` stays, `next_step_position→resumeNodeKey` computed via same position→node_key map as §3.5; add `context.flow_run_id` or `context.automation_graph_id` alias without destroying original row until resume succeeds. Cron `resumePendingExecution()` reads both `run_at WHERE pending` and new window re-check. |
| `automation_versions` | **Preserve** — not migrated; read-only archival. |
| `automation_trigger_evaluations` | **Preserve** — extend to log unified envelope evaluations. |

### 3.9 If old behavior cannot be represented

- **Manychat `Broadcasts/Sequences` drips that were encoded as `wait` chains inside automations:** Phase 1 migrates those `wait` steps as `smart_delay duration` nodes verbatim — not reinterpreted as Sequence subscriptions. Phase 6 (spec) may offer Sequence conversion helper but not auto-convert.
- **`goal` timeout jump `target_step_position`:** Migrated as `condition` node preceding a `smart_delay` stub with note `// TODO Goal P2` — runtime up until Phase 4 pauses at smart_delay but does not skip intermediate steps when goal fires; gap documented as P2 (docs/specs/node-system.md 4.3).
- **Flows `start` node whose `next_node_key` pointed at non-existent after manual edit:** Migration keeps dangling edge; validation will surface `error "Start points to non-existent"` rather than silently dropping.
- **Legacy `http_fetch`:** Migrated as `action make_external_request` but until Dynamic block lands (§5 spec) `fallback_next` not wired — error not fatal.

---

## 4. Compatibility — What happens to...

| Subject | After Phase 1 | Details |
|---------|--------------|---------|
| **Existing `automations` rows** | Remain, read-only, `is_active→false` | `SELECT` RLS intact, `INSERT/UPDATE/DELETE` disabled via policy change (or `is_active=false` soft deactivation). Migration flag column `migrated_to_flow_id UUID FK flows` added (NULL for pre-Phase 1 flows). Not hard-deleted until bake-out (3 releases later). |
| **Existing `flows` rows** | Uplifted in place (`trigger_envelope` backfilled, flat node types kept but allowed to coexist with new enums) | No `id` change; entries continue to resolve via `entry_node_key`. Validation that previously passed continues to pass. |
| **Active/running automations** (`flow_runs.status=active` or `automation_pending_executions.status=pending/done pending`) | **Not interrupted** — pending rows keep `run_at`, repointed via position→node_key map; active `flow_runs.current_node_key` stays valid (node_key not regenerated). Cron resumes correctly. |
| **Contacts / tags / custom fields / sequences** | Untouched | References preserved verbatim; no dereference. |
| **Logs / pending approx** | Old `automation_logs` read-only; new pending uses unified queue | API `GET /api/automations/[id]/logs` merges both for viewer parity; cron respects both `run_at` clocks. |
| **Flows/automations APIs** | `GET/POST /api/automations` canonical; `GET/POST /api/flows` alias that proxies through same service (adapter) | `docs/specs/node-system.md` alias decision §4.7 — single service backs both. Old `/api/flows` route files remain but delegate to `src/lib/automation/service.ts` (new) not old `src/lib/flows/engine.ts` directly. |
| **Builders** | Until Phase 2, both builders still render but read from unified graph via adapter — flows builder via `flow-editor-state.tsx:65` still works, automations basic-view via `stepsToNodes()` adapter still works | Phase 2 will collapse to single xyflow shell, but Phase 1 keeps both to avoid atomic cutover. |
| **Search / list views** | `GET /api/automations` list merges flows + migrated flows in one query (`UNION` over flows where `account_id=caller`) filtered by `status` | Maintains `Search by triggers / trigger state` UX from `14281111044124`. |

---

## 5. Rollback — Safe, Deterministic, Idempotent, Testable, Reversible

### 5.1 Deterministic + idempotent

- **Deterministic:** `node_key` generation `slugify(step_type+"_"+position+"_"+id.slice(0,6))` is pure function of `automation_steps.id` + position — re-running import yields same `flow_nodes.node_key` and same edges. Trigger mapping is pure copy.
- **Idempotent:** Import SQL uses `INSERT ... ON CONFLICT (flow_id, node_key) DO UPDATE` or pre-check `WHERE migrated_to_flow_id IS NULL` — re-running does not duplicate rows. `flows.trigger_envelope` backfill uses `WHERE trigger_envelope IS NULL`.
- **Testable:** Unit `src/lib/automation/migration.test.ts` asserts: representative old automation (keyword_match + condition yes/no + randomizer 60/40 + wait 2 hours + add_tag + send_buttons 2) → new graph produces identical `validateAutomationForActivation()` error set + edge count (position+1 mapping) + node count. Representative old flow (send_message→condition→set_tag→wait→handoff) → uplift preserves `entry_node_key` + edges.

### 5.2 Reversible (practical rollback)

```
Rollback window: until DROP automations is executed (bake-out ≥3 releases later). Before that:

1. For each flows row where migrated_to_flow_id IS NOT NULL (i.e., it originated from an automations import):
   - Reactivate original: UPDATE automations SET is_active = (flows.status='active'), updated_at = NOW() WHERE id = migrated_to_flow_id;
   - Do NOT delete the flows row — set flows.status='archived' instead, so double-run artifacts are revertible.

2. For uplifted flows (original flows backfilled with trigger_envelope):
   - trigger_envelope is additive — rollback is UPDATE flows SET trigger_envelope = NULL WHERE legacy trigger_type lane still captures original columns; no data loss.

3. For pending rows that were repointed (next_step_position → resumeNodeKey):
   - Keep original columns next_step_position/branch intact alongside new context.resumeNodeKey — rollback reads old columns again.

Result: original automations + original flows both recover verbatim; unified reads (`v_automation_graphs`) flip back to old service under flag ENABLE_MANYCHAT_PARITY_GRAPH=false.
```

**Backup:** Pre-migration `pg_dump --table=automations --table=automation_steps --table=flows --table=flow_nodes` stored as artifact (not auto-rollback, but safety).

### 5.3 Failure modes

| Failure | Rollback |
|---------|----------|
| Migration transaction partially committed (e.g., flows row inserted but flow_nodes half-written) | Entire per-automation import wrapped in single SQL transaction — rollback on error leaves `migrated_to_flow_id` NULL, so re-run is clean. |
| Validation after migration surfaces new errors (dangling edge) | Do not auto-archive legacy — set new flows.status=draft and flag for manual fix; never delete legacy is_active source. |
| Pending resume during migration cutover double-resumes | Cron's optimistic flip `UPDATE automation_pending_executions SET status='running' WHERE id=:id AND status='pending'` (existing `src/lib/automations/engine.ts:1287` `markPending()`) ensures at-most-once even across engine variants. |

---

## 6. Migration Not Required Now (Phase 1 additive, not destructive)

For Phase 1 the migration is **opt-in via importer** (seeded in `src/app/api/automations/import/route.ts`) and **trigger_envelope backfill** for flows (one SQL `UPDATE flows SET trigger_envelope = jsonb_build_object('triggers', jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'kind', trigger_type, 'channel', trigger_config->>'channel', 'config', trigger_config, 'enabled', true))) WHERE trigger_envelope IS NULL`). The bulk automations→flows import is **not auto-run on deploy** — admin runs once per account or on `POST /api/automations/import?account_id=...` dry-run. This avoids surprise destructive migration on Phase 1 foundation release.

Graph alternatives considered and rejected for Phase 1: new table `automation_graphs` replacing `flows` — would duplicate RLS/realtime publication (`supabase_realtime ADD TABLE flow_runs` at `010_flows.sql:272`) and require broader RLS rewrite — deferred; `flows` evolution is cheaper and keeps `idx_one_active_run_per_contact`.

---

## 7. Audit Confirmation Checklist

- [x] Graphify confirmed dual persistence (§1.1 tables + indexes + RLS) and adapter evidence `stepsToNodes()`.
- [x] Graphify confirmed `flow_runs` concurrency index + pending queue pattern for both engines.
- [x] Spec Manychat target (6 families + AI Step + 12 content blocks + heterogeneous edges + trigger OR + 30-block guard) is incompatible with preserving sequential `automation_steps.position` as canonical — requires container + edges-in-config.
- [x] Doc records deterministic/idempotent/reversible strategy; history not destroyed; rollback via archived flows + reactivated automations.
- [x] Checklist §6 add-ons verified additive; Phase 1 does NOT require new builder UI/logic — foundation only.

---

*End Phase 0 audit. Phase 1 builds canonical graph on top of this plan without dropping legacy rows.*
