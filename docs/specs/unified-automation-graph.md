# Unified Automation Graph — RETIRED (Historical Reference Only)

> **Status:** SUPERSEDED by `docs/ARCHITECTURE_DECISION_AUTOMATIONS_V2.md` (Phase 9 clean-slate retirement).
> The `flows` + `flow_nodes` tables this doc describes were dropped by
> `056_retire_automations_flows.sql`. This document is preserved as
> historical reference for v2 design discussions only — it is NOT
> implementation authority. Do not build on it.
>
> Original header (pre-retirement) follows unchanged:

> **Status (original):** Canonical as of `055_unified_automation_graph.sql` (Phase 1).  
> **Source:** `docs/research/MANYCHAT_PRO_FLOW_BUILDER_SPEC.md` (verified Manychat Pro target) + `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md` (approved: Manychat is target, existing Convox is starting point) + `docs/research/AUTOMATION_UNIFICATION_MIGRATION_PLAN.md` (Phase 0 frozen audit).  
> **Model:** `src/lib/automation/graph-types.ts:1` — `TriggerEnvelope {triggers[] OR} + nodes[] heterogeneous + edges derived from config`.

## Decision

> **The unified automation graph (`flows` + `flow_nodes` as canonical tables) is the source of truth.**

```
                 CANONICAL AUTOMATION GRAPH
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       Builder           Runtime           API
          │                │                │
          ▼                ▼                ▼
       Preview          Analytics       Integrations
```

- `flows` table (product name "Automations" in UI, table stays `flows` for data preservation) holds `trigger_envelope JSONB` (Manychat Starting Step — multiple triggers OR) + `entry_node_key` + `fallback_policy` + `version`.
- `flow_nodes` holds graph rows `node_key (stable string) + node_type (unified Manychat taxonomy) + config JSONB (heterogeneous edges inside) + position_x/y`. Legacy node_type values (`send_message` etc.) kept as aliases during migration window.
- `flow_runs` holds per-contact execution (`current_node_key, vars, pending_kind/until/context` for Smart Delay window/TZ + DataCollection timeout).
- `contact_randomizer_buckets` persists sticky randomizer per `(account,contact,flow,node)`.
- `preview_sessions` scaffolds split preview (In Manychat widget vs In messengers native).
- `automations` + `automation_steps` are **legacy read-only** after Phase 1. New writes via graph service `src/lib/automation/graph-service.ts:1`. Import is opt-in idempotent via `POST /api/automations/import`.

## What is NOT the intended future

- The old dual-engine model (`flows` graph engine vs `automations` sequential tree engine) is **not** the intended future architecture. It is the starting point. `src/lib/automations/automation-editor-adapter.ts:39` `stepsToNodes()/nodesToSteps()` existed as a bridge over the wrong primitive — now used only as one-time migration helper, not permanent layer.
- Basic Builder and Flow Builder are **two views over the same graph**, not two storages. Basic is a linear filtered render that hides fan branches (per `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md §2.2`). Do not treat either builder as independent persistence.

## Persistence rule

- Edges live **inside** node config (`next_node_key`, `buttons[].next_node_key`, `true_next/false_next`, `variants[].next_node_key`, `Choose Next Step`) per `010_flows.sql:8` reasoning and `src/lib/automation/edges.ts:1` heterogeneous derivation. No separate `flow_edges` table.

## API rule

- Canonical API is `/api/automations` backed by graph service `src/lib/automation/graph-service.ts:1`.  
- `/api/flows` remains as **temporary compatibility alias** delegating to same service during migration (not independent implementation). Both read `flows` + `flow_nodes` via service.

## Security invariant

- RLS + `account_id` tenancy + `auth.uid()=user_id` preserved on every table (`flows`, `flow_nodes`, `flow_runs`, new `contact_randomizer_buckets`, `preview_sessions`). No weakening.

## Trigger envelope rule

- `trigger_envelope.triggers[]` OR dispatch — multiple triggers entering same graph (e.g., keyword A ∨ keyword B ∨ tag_added). `trigger_type/trigger_config` legacy columns mirror first trigger for rollback compat. Validate via `validateGraphForActivation()` (severity `error|warning`).

## Node taxonomy (extensible without rewrite)

- Canonical `message | action | condition | randomizer | smart_delay | start_automation | ai_step | handoff | end` — each `config` is discriminated union in `src/lib/automation/graph-types.ts`. Heterogeneous edges derived per `src/lib/automation/edges.ts`. Legacy `send_* / set_tag / wait / collect_input / http_fetch / start` accepted during window.

## Migration rule

- `POST /api/automations/import` deterministic + idempotent per `src/lib/automation/migrate.ts:1` (`nodeKeyFor()` + `wireNextKeys()`). Legacy rows kept (`automations.migrated_to_flow_id` set, `is_active=false`) not deleted until bake-out. `flows.trigger_envelope` backfill preserves existing `trigger_type/trigger_config`.

*For implementation phases see `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md §6`.*
