# Architecture Decision — Automations v2 Clean Slate

> **Status:** Decision — Phase 9 retirement. The implementation removed in `056_retire_automations_flows.sql` and associated code deletions is **NOT** the foundation for the future Automations product.
> **Date:** Phase 9 (retirement audit approved)

## Decision

> **The retired Automations/Flows graph, builder, runtime, and Manychat-parity implementation are NOT the canonical foundation for the future Automations product.**

When Automations returns, it will be **rebuilt from total scratch** as a first-class Manychat-level product — visually, behaviorally, and functionally.

## What Was Retired (intentionally discarded)

- `flows` + `flow_nodes` graph (`node_key` string, edges-in-config)
- `BuilderState` (`src/components/flows/flow-editor-state.tsx`)
- `NODE_META` registry (`src/components/flows/shared.tsx`)
- `src/lib/flows/engine.ts` (1900 LOC), `fallback.ts`, `validate.ts`, `layout.ts`, `edges.ts`
- `src/lib/automations/*` tree (`builder-tree.ts`, `engine.ts` 1400 LOC, `validate.ts`, `templates.ts`, etc.)
- `src/lib/automation/*` unified graph (`graph-service.ts`, `migrate.ts`, `analytics.ts`)
- `preview-simulator` + `preview_sessions` + `contact_randomizer_buckets`
- `flow_run_events` timeline, `AutomationBuilder` / `FlowBuilder` canvas/list
- `src/app/(dashboard)/automations/*`, `src/app/(dashboard)/flows/*`, `src/app/api/automations/*`, `src/app/api/flows/*`
- Navigation `Zap` entry, dashboard quick-action, redirects

## What May Be Reused (only if future v2 explicitly chooses)

Generic infrastructure, **not** automation product logic:

- `accounts` + `is_account_member` + `handle_new_user` (`017`)
- `contacts`, `contact_tags`, `tags`, `custom_fields`, `contact_custom_values`
- `conversations`, `messages` (`channel`, `interactive_*`), `message_templates`
- `whatsapp_config`, `telegram_config`, `pipelines`/`deals`, `broadcasts`, `tasks` (except `source_automation_id` which remains nullable for history)
- `src/lib/channels/socket.ts`, `src/lib/whatsapp/*` (`meta-api`, `phone-utils`, `encryption`), `src/lib/supabase/admin.ts` (shared service-role)
- `src/lib/rate-limit.ts`
- `ai` provider infra (`src/lib/ai/providers/*`, `generate.ts`) — but **not** `ai_step` node coupling
- `sequences` engine/tables (`sequences`, `sequence_steps`, `sequence_enrollments`) — kept as standalone drip infrastructure, not as `enroll_in_sequence` step

Do **not** automatically carry forward: `flow_nodes` schema, `node_key` + `UNIQUE (flow_id,node_key)`, `position_x/y`, `flow_runs` state, `preview_sessions`.

## Manychat Research — Preserved as Reference

The following are **REFERENCE / PRODUCT RESEARCH**, not current implementation:

- `docs/research/MANYCHAT_PRO_FLOW_BUILDER_SPEC.md`
- `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md`
- `docs/specs/unified-automation-graph.md` (now historical — describes the retired graph)
- `docs/research/PHASE_1_IMPLEMENTATION_AUDIT.md` etc.

When Automations v2 is designed, these will be product requirements, not justification to preserve the deleted code.

## Future Automations v2 Principles

- **Visual builder:** Manychat-like infinite canvas, panning, minimap, heterogeneous handles per `deriveEdges` pattern — rebuild, not extend current `flow-canvas.tsx`.
- **Container interaction:** `Message` as `content_blocks[]` (Text/Image/Delay/DataCollection/File/Audio/Video/PDF/Card/Gallery/Messenger List/Dynamic) — not top-level nodes.
- **Editing:** Message `content_blocks[]` reorder, `Action` `tasks[]` — rebuilt.
- **Branching:** `Condition` `ALL/ANY`, `Randomizer` sticky (`contact_randomizer_buckets` pattern, not code), `Smart Delay` window/TZ — re-derive.
- **Triggers:** `TriggerEnvelope` `triggers[]` OR — re-derive, not preserve current `flow.trigger_envelope` JSON shape verbatim.
- **Lifecycle:** `Create → Edit → Save → Validate → Test (In Manychat vs In messengers) → Activate → Execute → Wait → Resume → Complete → Inspect analytics` — re-derive.
- **Channel behavior:** `ChannelTarget` `current|whatsapp|telegram` via `resolveChannelTarget` pattern, not code.
- **Generic infra listed above may be reused; product model rebuilt from first principles.**

## AI Agent Continuation Point

See `docs/research/PHASE_9_AUDIT.md` §9 for roadmap. After this retirement, AI Agent work resumes at **AI tool hardening** (keep `src/lib/ai/*` + `src/lib/messaging/channel.ts` + `src/lib/supabase/admin.ts` + `conversations.ai_*` columns).
