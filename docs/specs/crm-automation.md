# CRM ↔ Automation Contract — ConvoxOS (2026-08-31)

> Synthesized from `docs/research/highlevel-model.md` (CRM↔Workflow), `docs/research/channel-behavior.md`, `docs/specs/automation-product-spec.md` + existing migrations `001`–`046` + types `src/types/index.ts:99` + `src/lib/flows/types.ts` + `src/lib/automations/engine.ts:574`.

## 1. Entities the Automation Must Understand

| Entity | Table(s) | Current ConvoxOS | Target | Why required | Evidence |
|--------|----------|----------------|--------|--------------|----------|
| **Contact** | `contacts` | ✅ exists, account-scoped, `phone` nullable `041`, `telegram_user_id`/`chat_id`/`username`, `name/email/company` built-ins + `contact_custom_values` | Keep; add `dnd` flag? P3 (HighLevel Disable/Enable DND) | Conversation ownership, triggers, assignment | `types/index.ts:99` |
| **Conversation** | `conversations` UNIQUE(account,contact) | ✅ unified, no Conversation.channel, `status open|pending|closed`, `assigned_agent_id`, `last_message_*` | Keep; no split by channel | Inbox, dispatch routing | `036` + `types/index.ts:164` |
| **Message** | `messages` | ✅ unified with `channel` provenance CHECK whatsapp|telegram, `interactive_payload`, `interactive_reply_id`, `ai_generated` | Extend channel enum only | Conversation + ChannelSocket | `010` adds interactive widening, `041/042` channel |
| **Tag** | `tags`, `contact_tags` | ✅ | Keep | Segmentation + triggers `tag_added` + conditions + sequences | `types/index.ts:122` |
| **Custom field** | `custom_fields`, `contact_custom_values` | ✅ (`field_name`, `field_type`) | Keep; support `custom:<id>` binding already (`automations/engine.ts:578`) + validation | Data Collection → CRM for conditions | `types/index.ts:136` |
| **Opportunity / Pipeline** | `pipelines`, `pipeline_stages`, `deals` | ✅ `pipelines`+`stages`+`deals` (currency, expected_close, stage_id, assigned_to) `001`/`002`/`021` | Extend: need `Update Opportunity / Move Stage` nodes (currently create_deal only) + trigger Pipeline Stage trigger with stage filters | GHL Opportunity triggers parity P1 | `types/index.ts:358,376` |
| **Task** | — | ❌ missing dedicated table; legacy `contact_notes` via `001` is note only, not task with assignee/status/due | **P1 required**: new `tasks {id, account_id, contact_id nullable, assigned_to nullable, title, due_at nullable, status open|completed, source workflow id}` | HighLevel Task Added/Reminder/Completed triggers + Add Task action (contact-less allowed) — core CRM automation parity | `highlevel-model.md` §3.1 |
| **Note** | `contact_notes` (via `001`) + `contact_notes`? actually `contact_notes` /? table `contact_notes` exists — plus `contact_notes`? | ⚠️ `contact_notes` exists but engine has no Add Note node (`notes` only via `contact-detail-view`) | **P1 required**: add `add_note` Automation/Flow node (contact_id, body) | HighLevel Add Note + Note Added/Changed triggers + chat closure note | `001` includes notes |
| **Appointment** | — | ❌ no appointment table | **P1 for ConvoxOS?** Determine: if no calendar product, defer Appointment Status/Booked triggers to P3/P4. If sales use calendar, P2. For now P3. | GHL Appointments category; not ManyChat; scope optional until product decides to own calendar | — |
| **Assignment** | `conversations.assigned_agent_id` + `profiles` + `account_sharing` | ✅ via `assign_conversation` step + `handoff {assign_to}` | Add `Remove Assigned User` counterpart P3 | CRM workload | `types/index.ts:164`, `017` sharing |
| **Activity** | Not a separate table — derived from `messages`, `contact_notes`, `deals`, `flow_run_events`, `automation_logs` | ⚠️ No Activity feed aggregation | **P2**: unified `activities` view (or feed) aggregating messages+notes+deal moves+assignments+task creation for contact timeline | CRM traceability |
| **Automation** | `automations`, `automation_steps`, `automation_logs`, `automation_pending_executions` | ✅ (`006`/`007` + `043` pending shared) | Keep; add Start Automation / Add to Workflow P2 | Runtime |
| **Sequence** | — | ❌ not a domain object | **P2** new `sequences` + `sequence_messages` + `contact_sequences` enrollment | ManyChat parity (§12) | — |
| **Broadcast** | `broadcasts`, `broadcast_recipients`, `message_templates` | ✅ template-based with `delivery_locked_at` `038` | Keep; add audience segmentation + channel selection P2 | ManyChat Broadcast parity | — |
| **AI Agent** | `ai_configs`, `ai_knowledge_documents`, `ai_knowledge_chunks` | ✅ AI reply/knowledge (`029`/`030`) via `processNormalizedInbound` fan-out | Add Workflow AI action (prompt) P3 as Integration | GHL Workflow AI | `ai/types.ts:12` |
| **Knowledge** | `ai_knowledge_*` | ✅ | Already AI-friendly | — | `ai/knowledge.ts:1` |

**Proven required new entities now:** `tasks` (dedicated table) P1. **Deferred:** `sequences` P2, `activities` view P2, `appointment` P3. Do not add `tasks` schema here — read-only phase only documents contract.

## 2. What Each Entity Mutates / Reads / Triggers

| Entity write/read | Automation trigger on change? | Automation node can read in Condition? | Automation node can write? | Channel relevance |
|-------------------|-------------------------------|----------------------------------------|----------------------------|-------------------|
| Contact create | ✅ `contact_created` (target) `new_contact_created` existing | yes `contact_field` | yes `update_contact_field` built-in + custom | any channel |
| Contact field change | ✅ `contact_changed` (target P1) | yes | yes | — |
| Contact tag add/remove | ✅ `tag_added` + `contact_tag` already | yes `tag` / `tag_presence` | yes add/remove tag | — |
| Custom field value change | ✅ `custom field value changed` (ManyChat Rules) target P1 | via `var` / `contact_field`? separate `custom` subject | yes custom | — |
| Note added/changed | ✅ target P1 | via activity feed P2 | Add Note P1 | — |
| Task added/changed/completed | ✅ target P1 (requires tasks table) | — | Add Task P1 | — |
| Conversation assigned | ✅ `conversation_assigned` already | — | `assign_conversation` / `handoff` + `close_conversation` | any |
| Message inbound (any) | ✅ `customer_replied` / `new_message_received` | `message_content` | `send_*` writes `messages` + `conversations.last_message_*` | WA/TG specific via channel filter |
| Button/list tap | ✅ `interactive_reply` | — | — | WA/TG reply_id |
| Deal create/move/stale | ✅ GHL pipeline triggers target P1 | `contact_field`? opportunity fields needed P1 | `create_deal` now, missing update/move | — |
| Appointment book/status | ✅ P3 | — | Update Appointment Status P3 | — |
| Form/survey submit | ✅ (GHL) P2 | — | — | — |
| Inbound webhook | ✅ P1 | — | — | — |

## 3. Opportunity vs Contact Field Semantics

HighLevel's critical contract (verified in Webhook Action `155000003299`):

> `data payload is context-dependent. To get data for a specific object like an opportunity, the workflow must be triggered by an event related to that opportunity (e.g., Pipeline Stage Changed). A generic Tag Added trigger will only send contact-level data.`

**ConvoxOS target:** Same. When a workflow/automation is triggered by `pipeline_stage_changed` or `opportunity_created`, the `context` carries `opportunity_id`, `pipeline_id`, `stage_id`, `value`, `owner` such that downstream `update_contact_field` / `send_webhook` can reference opportunity vars (`{{opportunity.value}}`). A Tag trigger carries only `contact_id` + `tag_id` and cannot reference opportunity.

Current `AutomationContext` + `automation_pending_executions.context` carry `conversation_id`, `trigger_channel`, `vars`, `tag_id`, `agent_id`, `interactive_reply_id` but **no opportunity fields** — gap P1 for payload trigger-dependency warnings in `send_webhook` body builder.

## 4. Automation ↔ CRM Execution State

### 4.1 Per-contact lifecycle surfaced in CRM

| State | Where persisted | Who can see it | What CRM shows |
|-------|----------------|---------------|---------------|
| `enrolled` (trigger matched) | `automation_logs` row `failed` default inserted before any step (`engine.ts:192`) | Automation Logs viewer, Contact detail Automation Resources tab | "Automation X started at HH:MM" |
| `running` (steps executing synchronously) | In-memory until log append | same | Current step detail via `steps_executed` |
| `waiting` (at Wait) | `automation_pending_executions {status:pending, run_at, context.next_*}` (Flow: `flow_run_id` row; Automation: `parent_step_id/branch/log_id/vars`) | Flow Runs page waiting indicator; Stats View `Waiting`; Contact detail banner "In automation — waiting until HH:MM" target P1 | Resume time |
| `branched` (after Condition) | `steps_executed` detail `branch=yes/no`; `flow_run_events {condition_result}` | Log detail | Which branch taken + which condition matched value |
| `goal_reached` (when Goal P2) | Jump event | Log + conversation feed | Skipped steps collapsed |
| `completed / handed_off` | `flow_runs.status`, `automation_logs.status=success` + `endReason` | History viewer | Completion reason; handoff note + assignment |
| `failed` (provider/validation/CRM) | same with error detail | Error badge + detail string | `send_text_failed: …` |
| `cancelled` (Remove from workflow P2) | `flow_runs.status=cancelled` / `automation_pending_executions.status=cancelled` | Log | Cancellation actor + reason |
| `timed_out` | `flow_runs.status=timed_out` via sweep after `fallback_policy.on_timeout_hours` | Timeout badge | `timeout` |

### 4.2 What CRM record shows while automation is active

- **Contact detail:** timeline entry per enrollment + per waiting state + per mutation (tag added, field updated, deal created). Tasks can attach to contact or be contact-less (GHL verified) — allow `tasks.contact_id nullable`.
- **Conversation:** header pill "Flow X at node Y" via `flow_runs` realtime publication; inbox thread quotes `last_prompt_message_id` context-aware list.
- **Opportunity / Pipeline Kanban:** card stage + value + assigned; move triggered by `Pipeline Stage Changed` creates new run; deal card shows "last automation X at HH:MM".
- **Inbox assignment:** `assigned_agent_id` mutated by `assign_conversation` / `handoff`; activity event `conversation_assigned` triggers relevant automations.

### 4.3 Enrollment, Re-entry, Concurrency, Cancellation

- **Enrollment:** Trigger fire per event creates exactly one run/log. `runAutomationsForTrigger` loops automations matching type+channel, inserts log pessimistically `status=failed` before steps, flips to `success/partial/failed` at end (so crash before first step is not mis-reported as success).
- **Re-entry:** No automatic suppression — same contact+event can create multiple logs/runs if trigger fires again. Caller must gate via tag check/condition or `stop-on-response` flag (GHL `stop-on-response` not yet — P2).
- **Concurrency:** Flow: up to N concurrent active runs per contact (one per `flow_id`) (`044`). Automations: concurrent logs per trigger (loop). Waiting `pending` executions run independently via cron — multiple pending for same contact can coexist (different automations/flows). `dispatchInboundToFlows` channel-aware resume avoids waking TG flow with WA reply (WA/TA isolated per trigger_channel+replyId exact isolation, `resume-channel.test.ts:1`).
- **Cancellation:** `Remove from Workflow` equivalent (not yet) would set pending status `cancelled` and inactivate run; plus `DND` pause. Draft toggle preserves waiting (not cancelled) — distinct.
- **Multiple opportunities:** `Create/Update Opportunity` + `Remove Opportunity` per pipeline; multiple opportunities per contact can exist (GHL verified: action can remove from specific or all pipelines). ConvoxOS `deals` already supports many per contact; trigger should carry opportunity context to distinguish which one.
- **Stop-on-response:** GHL feature where any reply cancels waiting marketing steps. Not in ConvoxOS — candidate P2 via Goal that jumps to end on `customer_replied`.

### 4.4 CRM Consistency & Audit

- **Account scoping:** Every pending row carries `account_id`; service-role writes guarded by pre-check `contacts.account_id == accountId` in `runAutomationsForTrigger:97`. Future writes must keep same guard for tasks/notes/opportunities.
- **Tenant-isolated partial index:** `idx_one_active_run_per_contact` via `account_id` not just `user_id` ensures cross-account same phone number runs don't collide — migration `044` correctly changed from `(user_id,contact_id)` to `(account_id,contact_id,flow_id)` allowing per-flow uniqueness.
- **Storage discipline:** Messaging media stays in `chat-media`/`flow-media`; knowledge/embedding chunks in `ai_knowledge_chunks`; pending execution snapshot `context.vars+next` is durable but does not carry PII text beyond captured vars already logged `captured_length` only.
- **History fidelity:** `flow_run_events` append-only + `automation_logs.steps_executed` merged via `appendResults` (nested branch append without overwriting status) give full fidelity. Do not compact logs.

## 5. What ConvoxOS Must Add to Be CRM-Native (prioritized)

1. **P1 Task entity** (new table) + `Add Task` node + `Task Added/Completed/Reminder` triggers.
2. **P1 Note node** `Add Note` + `Note Added/Changed` triggers (table already exists via `001`; engine path missing).
3. **P1 Opportunity R/W** — add `Update Opportunity / Move Stage` nodes + `Pipeline Stage Changed / Opportunity Status Changed / Stale` triggers with opportunity-aware Webhook context.
4. **P1 Contact Changed trigger** + generic change detection (field whitelist, value equality) — needed for CRM field parity with Rules.
5. **P2 Sequences** + **P2 Activity feed** aggregation + **P2 Goal** + **P2 Remove from Workflow** / cancellation.
6. **P3 Appointment** if calendar product owned.
7. **P3 DND** pause toggle.

Not required for serious product claim: Company-Based Workflows, Affiliate/Courses/Payments/Ecommerce/IVR/Communities categories (enterprise GHL extensions).

---
*Implementers: every new trigger must carry correct `context` shape for trigger-dependent payload warnings; every new action must be account-scoped (prove `account_id` guard in code review).*
