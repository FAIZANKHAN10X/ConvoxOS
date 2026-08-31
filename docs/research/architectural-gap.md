# Architectural Gap Analysis — ConvoxOS (2026-08-31)

> HEAD `752583e`; target contracts `docs/specs/*.md`. Thin ChannelSocket principle preserved. No new abstraction without evidence.

## 1. What Already Works — Keep

| Area | Why it supports target | Evidence |
|------|------------------------|----------|
| **Unified contacts** `phone nullable` + `telegram_user_id BIGINT UNIQUE(account,telegram_user_id)` null islands not counted; `phone_normalized` dup index | Handles WA+TG without Conversation.channel split | `041_channel_provenance_nullable.sql:1`, `src/lib/inbound/processNormalizedInbound.ts:105` |
| **`messages.channel` provenance** CHECK `whatsapp|telegram` NOT NULL DEFAULT whatsapp + indexes | Channel hops in one thread without Conversation.channel column | `042_channel_not_null_enforce.sql:1` |
| **`flow_runs.trigger_channel` snapshot + AutomationContext.trigger_channel** | `Current` fidelity; waiting resolution uses original not new channel | `043`, `src/lib/flows/engine.ts:175,714`, `src/lib/automations/engine.ts:63` |
| **ChannelSocket thin explicit** `dispatchText:65 dispatchMedia:110 dispatchInteractive:177 + resolveChannelTarget:222` delegating to `whatsapp/send-message` & `telegram/send*` | No ChannelFactory needed; adding channel = explicit branch not registry | `src/lib/channels/socket.ts:1` 233 lines only |
| **Normalized inbound fan-out** `processNormalizedInbound` contact→conversation→message→bump→reopen→WA broadcast flag→flows (+channel)→automations (+channel)→AI→webhook | Single shared host; ordering preserved | `src/lib/inbound/processNormalizedInbound.ts:232,342` |
| **Pending execution unified table** `automation_pending_executions` reused for both Automation wait and Flow wait via `flow_run_id` nullable + `chk_pending_target` | No duplicate wait scheduler | `045_flow_wait.sql:6`, `006_automations.sql:119` partial idx |
| **Channel-aware resume** all active runs scanned + `trigger_channel` mismatch skip + `replyId` exact match isolation | TG Flow A + WA Flow B can both wait | `src/lib/flows/engine.ts:1052,1073`, `resume-channel.test.ts:1` |
| **Per-flow uniqueness** `UNIQUE(account,contact,flow_id) WHERE active` | Concurrent channel wait for same contact | `044_flow_run_per_flow_uniqueness.sql:1` |
| **Fallback / dedup / idempotency** `meta_message_id` duplicate inbound check + `current_node_key` optimistic UPDATE + `23505` INSERT race | No locking; webhook retries safe | `src/lib/flows/engine.ts:351,1015,1343` |
| **Account tenancy** `accounts`, `is_account_member`, service-role guard `contacts.account_id == accountId` pre-dispatch `src/lib/automations/engine.ts:96` | Cross-account isolation already correct | `017_account_sharing.sql:188` adds account_id to pending + flows |
| **Unreachable / dangling validation** `deriveCanvasEdges` + `reachableFromEntry` BFS + per-node required field checks `src/lib/flows/validate.ts:808` | Deterministic graph | `src/lib/flows/edges.ts:1` pure |

## 2. What Needs Change — Only With Evidence

| What | Why not optional | Minimal change | When |
|------|------------------|---------------|------|
| **Channel capability gate in validation** — buttons ≤3 WA vs ≤10 TG per `channel_target` | Current `validateFlowForActivation:362` + `validateInteractivePayload:136` uses fixed `INTERACTIVE_LIMITS.maxButtons` regardless of target → TG valid builds blocked (P0 correctness bug) | Branch validate on `config.channel_target`/`step_config.channel_target`; TG path allow 10 + `callback_data 64B` + URL check; WA path keep 3/ limits | P0 |
| **Tasks entity** — new `tasks` table | GHL Contact category `Task Added/Reminder/Completed` triggers + `Add Task` action (contact-less allowed) — core CRM workflow parity P1. No table exists today `grep tasks` empty; cannot implement tasks without it | New migration `0XX_tasks.sql {id, account_id, contact_id nullable, assigned_to nullable, title, status, due_at, source_workflow}` RLS + `tasks` RLS | P1 |
| **Notes/Add Note node** | `contact_notes` exists `001` but no workflow node `add_note` to create from automation | Add node type `add_note` + `Note Added/Changed` triggers wiring (table already exists) | P1 |
| **Opportunity R/W completeness** | `create_deal` only; missing Update/Move/Remove despite `pipelines/stages/deals` existing | Add step types `update_deal|move_deal|remove_deal` + triggers `opportunity_status/pipeline_stage_changed/stale` with stage filters; opportunity-aware context for webhook payload | P1 |
| **Trigger catalog expansion** | 8 → 80+ per GHL list; HighLevel parity requires `contact_changed/dnd, customer_replied, inbound_webhook, form_*, appointment_*, opportunity_*` | Each trigger = new `trigger_type` value + `trigger_config` JSONB schema + `triggerMatches` case + `processNormalizedInbound` fan-out addition; inbound_webhook needs new route | P1 (core subset), P2 remainder |
| **Wait full fidelity** | Fixed duration only vs ManyChat Duration+Window+Day+T Z+all vs GHL business hours | Expand `WaitNodeConfig/WaitStepConfig` to `type: duration|date` with optional `continueBetween HH:mm + days + tz + offset` then `waitMsForFlow` + builder row + pending `run_at` calc | P1 |
| **Condition multi-predicate** | Single predicate vs ManyChat `all/any` multi group | Change `ConditionNodeConfig` to `conditions:[{subject,operator,value,subject_key}] + matchMode all|any`; engine evaluate conjunct | P1 |
| **Cycle guard** | Flows safety cap 64 iterations `engine.ts:694` catches loops at runtime but publish should block obvious cycles | DFS cycle detection in `validateFlowForActivation` (allow cycles that exit via condition branch still warn) | P1 |
| **Sequences & Broadcasts audience** | No `sequences` domain; broadcasts lack audience segmentation | New `sequences` + `sequence_messages` + `contact_sequences` enrollment; broadcasts add `audience_filter JSONB` already exists but builder not surfaced + channel selection | P2 |
| **Embed edges vs separate table** — keep as-is. Edges-in-config JSONB is correct: single-row runner lookup, no join, builder unit is node. Do NOT introduce `flow_edges` table — validator already enforces cross-node integrity | — | — | Keep |

## 3. What Does NOT Need Change — Rebuttal

| Tempting abstraction | Why not now | When it would be justified |
|----------------------|-------------|----------------------------|
| **`channels` table + Conversation.channel** | Unified thread per (account,contact) with per-message `channel` already supports mixed history without split; adding `Conversation.channel` forces migration and inbox filter complexity already solved via `messages.channel` provenance | Never for 2 channels; if analytics needs `conversation.primary_channel` derived aggregate view is enough |
| **`ChannelFactory/Registry/ChannelSender`** | `socket.ts:1` 233 lines explicit branching proves two channels without factory; third channel adds one `if (channel===instagram)` branch, not a registry; registry adds indirection without value now | When 4+ channels have largely identical quirks (not today — each provider's auth/payload/limits diverge enough to warrant explicit) |
| **`channels` config polymorphic table** | Per-provider `*_config` encrypted table pattern (`telegram_config` mirrors `whatsapp_config`) already encrypted at rest, `STATUS`, RLS admin write | When channel install UX needs generic listing (marketplace) — not while WA native core stays |
| **Microservices** | All inbound/outbound paths run in Next.js serverless (webhook + send routes + cron) with durable PG queue (`automation_pending_executions`). No scale bottleneck observed; no need to split flows vs automations into services | At 10x scale with separate teams owning channels |
| **Event bus / CQRS** | NormalizedInbound fan-out is synchronous ordering: bump→reopen→flagBroadcast→flows→automations→AI→webhook. Async bus would break ordering guarantees and dedup semantics (`meta_message_id` duplicate check, optimistic `current_node_key`) | When cross-region or out-of-process workflows needed |
| **Generic plugin framework** | Already decided `stay boring` per `ROADMAP.md:26`; explicit socket + per-module `normalize/send` is maintainable (`Telegram as first plug proves`) | Second proven external plug + in-product connection UX forces it per `docs/CHANNEL_ARCHITECTURE.md:40` |

## 4. Schema-Only Changes Still Needed (non-destructive additive)

- Extend `messages.channel CHECK` to add `instagram|messenger` values when those plugs ship (requires migration touching CHECK — additive safe).
- Add `tasks` table (new migration, RLS).
- Optional `goals` column on `automation_pending_executions` or reuse `context.goal_id` — no schema for goal skip-ahead until P2.
- `flows` draft vs published separate flag as P2 (optional boolean `is_published` distinct from `status`) — not required before.

## 5. Builder ↔ Runtime Contract Invariants to Enforce After Changes

1. `channel_target` must be non-null at publish (already); legacy null→whatsapp compat only in engine, never shown in builder.
2. TG button cap 10 must be enforced only when `channel_target` resolves to `telegram` (direct or via `current` snapshot known to be telegram at validation time — if snapshot unknown (`any` trigger), require stricter WA cap or warn).
3. `current` requiring snapshot must never silently default to whatsapp — keep `channel_target_missing` error.
4. Flow `trigger_channel` on `flow_runs` and pending `context.trigger_channel` must be snapshotted at enqueue, not re-derived on resume.
5. `resolveChannelTarget(current, snapshot)` stays pure — no DB.

---
*Teams checklist: every new migration must keep `automations/automation_logs/automation_pending_executions` account_id NOT NULL guard from `017`; new entity must add `is_account_member` RLS pattern; never add factory in socket.*
