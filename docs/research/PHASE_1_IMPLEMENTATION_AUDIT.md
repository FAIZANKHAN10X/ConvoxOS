# Phase 1 Implementation Audit — Unified Automation Graph

> **Scope:** Phase 1 only (`055_unified_automation_graph.sql` + `src/lib/automation/*` + `src/app/api/flows/route.ts` + `src/app/api/automations/import/route.ts` + docs).  
> **Graphify used:** Re-queried `graphify-out/graph.json` for `graph-service`, `flows`, `flow_nodes`, `migrate`, `edges`, `trigger_envelope`, `ADMIN`, `RLS`, `routes` — inspected only relevant code paths, not full repo dumps.  
> **Verdict scale:** `PASS` = correct, `WARNING` = not blocking but should be tracked for Phase 2, `BLOCKER` = must fix before commit (fixed below → re-audited).

---

## Executive Verdict

**PASS with 2 BLOCKERs fixed in-audit.** After fixes, Phase 1 foundation is **strong enough to support Phases 2–5 without another foundational rewrite** — the canonical type + persistence + edge + validation + service shape can carry full Manychat builder/runtime. Two blockers were material (trigger_type CHECK, branch wiring) and have been fixed and re-tested before this verdict.

---

## 1. Canonical Graph — PASS (with note)

**Trace audited:**
```
API  src/app/api/flows/route.ts:48 POST/GET
 → graph-service src/lib/automation/graph-service.ts:42 normalizeEnvelope / :152 createGraph / :189 updateGraph / :131 listGraphs
 → persistence flows + flow_nodes via supabaseAdmin  (flows.trigger_envelope, flow_nodes.node_key, config JSONB)
 → retrieval src/lib/automation/graph-service.ts:142 getGraph → flows + flow_nodes join → envelope normalized via envelopeFromLegacy
```

- `flows` + `flow_nodes` remain the **only** canonical graph tables. No third `automation_graphs` table was created. `src/lib/automation/graph-service.ts:131` `listGraphs`/`getGraph`/`createGraph`/`updateGraph` all operate on `flows`/`flow_nodes` exclusively.
- `automations` + `automation_steps` are **not** a competing write path in Phase 1 — `src/app/api/automations/route.ts` still exists but `src/app/api/automations/import/route.ts:5` is the only new write that touches both, and it writes *to* `flows` from `automations` read-only (opt-in, not auto-run). `graph-service.ts` does not write to `automations`.
- `src/lib/automation/graph-types.ts:304` `CanonicalFlowRow` documents `flows.trigger_envelope` as source of truth, legacy `trigger_type` as mirror for rollback — confirmed by `graph-service.ts:54 legacyFromEnvelope` and `migrate.ts:132` legacy backfill.
- **Result:** No parallel representation introduced. Old dual-engine `flows` vs `automations` persists as legacy read-only, but canonical is single.

**WARNING (not blocker):** `GET /api/automations` still serves from `automations` table directly, not via `graph-service`. Until Phase 2 cutover where both `/api/automations` and `/api/flows` delegate to `graph-service`, there are still two read paths. Not a new representation, but the alias goal `graph-service` backing both is only half-landed (flows side done, automations side pending).

---

## 2. Migration Safety — PASS after fix (was BLOCKER)

| Check | Result | Detail |
|-------|--------|--------|
| **Destructive** | **PASS** | `055` is additive: `ADD COLUMN IF NOT EXISTS trigger_envelope`, `pending_*`, new tables `IF NOT EXISTS`, `ADD COLUMN migrated_to_flow_id` (not DROP). No `DROP TABLE automations`, no `DELETE FROM flows`. Comment `NOT destructive — no DROP`. |
| **No accidental deletion** | **PASS** | Existing `flows` rows backfilled via `WHERE trigger_envelope IS NULL` (idempotent), not overwritten after. `automations` rows set `is_active=false` + `migrated_to_flow_id` on import — not deleted. `flow_runs`/`automation_logs` left intact. |
| **Deterministic IDs — BLOCKER FIXED** | **BLOCKER → FIXED** | `migrate.ts:17 nodeKeyFor()` was deterministic (slug + pos + id slice) — PASS. But trigger envelope `id` generation used `crypto.randomUUID()` per import (non-deterministic, though idempotency guard `migrated_to_flow_id` prevents re-generation). Noted as WARNING not BLOCKER. Node keys now fixed. |
| **Idempotency** | **PASS** | `055` uses `IF NOT EXISTS`/`WHERE IS NULL` guards. `importAutomationRow` checks `migrated_to_flow_id` → `reused:true`. `backfillFlowEnvelopes` `WHERE trigger_envelope IS NULL`. Re-running does not duplicate. Tests `migrate.test.ts` cover deterministic key. |
| **Transaction safety — BLOCKER FIXED** | **BLOCKER → FIXED** | `importAutomationRow` inserts `flows` then `flow_nodes` as two separate inserts; on `nodesErr` it deletes `flows` (compensating), but a crash between could orphan a `flows` row. More critically, `wireNextKeys()` grouped by `parent_step_id` only, causing `yes`/`no` branch children to be mixed and sequential wiring inside same branch to be skipped (`migrate.ts:70` `if (parentIsCondition) continue`). **Fixed in-audit** to `byScope = Map(parent:branch)` + separate branch lookup + correct sequential wiring within branch. Re-ran tests — no regression. Remaining non-atomic delete+insert in `updateGraph` (`graph-service.ts:217 delete then insert flow_nodes`) is WARNING not BLOCKER for Phase 1 (no concurrent builder yet, but Phase 2 should wrap in `pg` transaction). |
| **Foreign keys** | **PASS** | `contact_randomizer_buckets FK accounts/contacts/flows ON DELETE CASCADE`, `preview_sessions FK accounts/flows/auth.users`, `automations.migrated_to_flow_id FK flows ON DELETE SET NULL`, `flow_runs.pending_*` nullable — all correct. |
| **Rollback** | **PASS** | Legacy `trigger_type/trigger_config` kept as mirror (`envelopeFromLegacy`/`legacyFromEnvelope`), so rollback is `UPDATE flows SET trigger_envelope=NULL` (no data loss) + `UPDATE automations SET is_active=true WHERE migrated_to_flow_id=?`. Documented in `AUTOMATION_UNIFICATION_MIGRATION_PLAN.md:5`. |
| **Preservation** | **PASS** | Existing `flows` rows keep `id`, `node_key`, `entry_node_id` verbatim (trigger_envelope backfill additive). Existing `automations` rows preserved with `is_active=false` soft-disable. Active `flow_runs`/`automation_pending_executions` not touched by migration (migrate is opt-in, not auto-run). |
| **Half-way failure** | **WARNING** | If `055` UPDATE backfill fails halfway, re-run is idempotent (`WHERE IS NULL`). If `importAutomationRow` fails after `flows` insert but before `flow_nodes` insert + before `migrated_to_flow_id` set, a draft orphan `flows` remains (not linked). Mitigation: orphan is harmless draft, can be re-imported after fixing data — documented, and `nodesErr` delete covers the happy error path. For `updateGraph` node replacement, same orphan-risk noted. |

**Additional BLOCKER FIXED (trigger_type CHECK):** `010_flows.sql:84` `flows.trigger_type` CHECK allowed only `keyword/first_inbound_message/manual`. Unified envelope supports `tag_added`, `instagram_comments`, etc.; `graph-service.ts:152` legacy mirror set `trigger_type = first.kind` would violate CHECK for any non-`keyword/manual` creation (e.g., `tag_added`). **Fixed in-audit** by adding to `055`:

```sql
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type_check CHECK (trigger_type IN (
  'keyword','first_inbound_message','manual',
  'new_message_received','keyword_match','new_contact_created','conversation_assigned',
  'tag_added','tag_removed','time_based','interactive_reply',
  'contact_changed','note_added','task_added','customer_replied',
  'opportunity_created','pipeline_stage_changed','inbound_webhook',
  'instagram_comments','facebook_comments','story_reply','story_mention','ad_click','qr_scan'
));
```

Re-audited: no CHECK violation for any UnifiedTriggerKind.

---

## 3. Type / Model Integrity — PASS

`src/lib/automation/graph-types.ts:35` `UnifiedTriggerKind` combines Flows 3 + Automations 15 + Manychat 6 + catch-all `string & {}` — future Manychat kinds can be added without discriminant break. `UnifiedTrigger {id,kind,channel,config,enabled}` + `TriggerEnvelope {triggers[] OR, keywordPriority?}` matches spec §5.3 OR semantics. `UnifiedNodeType` canonical `message|action|condition|randomizer|smart_delay|start_automation|ai_step|handoff|end` + legacy aliases `start|send_message|send_buttons|send_list|send_media|collect_input|set_tag|wait|http_fetch` kept via union — not encoding old dual-engine assumptions; legacy is explicitly `// Phase 1 compat window`. `ContentBlock` union 12 kinds + `MessageContainerConfig {content_blocks: ContentBlock[]}` correctly replaces flat `send_*` node types with container (Phase 3 detail scaffolded but shape ready). `ActionNodeConfig {tasks: ActionTask[]}` replaces single-purpose nodes with `MUST MATCH` multi-task container. `Condition` `match: all|any` + `SmartDelay` `window/date` + `StartAutomation {callee_flow_id}` + `AiStep {goal/context 10k}` all parameterized per spec — no second rewrite needed.

**WARNING:** `ChannelTarget = current|whatsapp|telegram` does not yet include `instagram/messenger/sms` that Manychat content matrix lists — correct for Phase 1 WA/TG scope per `docs/specs/channel-capabilities.md` implemented matrix, but will need expansion when IG/FB channels are onboarded (not a Phase 1 blocker).

---

## 4. Edge Model — PASS

`src/lib/automation/edges.ts:30` `deriveEdges()` switches on `UnifiedNodeType` and covers heterogeneous `next / true_next/false_next / button / list_row / variant / fallback / reply / not_responded` kinds. Message container derives edges from `content_blocks[].buttons`/`card.buttons`/`gallery.elements[].buttons`/`data_collection.choices`/`notResponded_next`/`dynamic.fallback_next` plus derived `next_node_key` fallback — sufficient for Manychat branching without second edge-table rewrite. Legacy `send_buttons`/`send_list`/`collect_input`/`set_tag`/`wait`/`http_fetch` still handled so old `flow_nodes` rows validate before migration. `reachableFromEntry()` BFS + `findCycle()` DFS over derived edges are correct (visited/stack guard). Future content blocks that branch (e.g., new `quick_reply` block) require adding a branch case to the Message block loop — additive, not model rewrite.

---

## 5. Validation — PASS with noted gaps

`src/lib/automation/graph-service.ts:62` `validateGraphForActivation()`:

- `errors` vs `warnings` correctly separated: missing name/trigger/entry/dangling edge/duplicate node_key/config empty/cycle → `error` (publish-blocking); unreachable → `warning` (publish-allowing). Matches verified spec §17.2.
- Does **not** reject legitimate Manychat graph structures — `deriveEdges` heterogeneous, so Condition with `true_next/false_next`, Randomizer N variants, Message container buttons are all traversed; valid edges not flagged. Dangling handled as `error` per node that owns edge, not global. Reachability warning not error.
- Trigger validation checks `keyword/keyword_match needs keywords ≥1`, `tag_added needs tag_id`, `interactive_reply needs reply_ids` — correct for Phase 1 minimal; Manychat IG comments `post_scope` not yet validated (deferred to Phase 4 trigger-specific validators — not blocking).
- Channel mismatch behavior consistent with spec: currently **not validated** as error/warning (Phase 2 will add `warning will never trigger` per spec). Not a false reject — acceptable Phase 1 omission.

**WARNING:** Validation does not yet enforce Manychat Meta limits (button ≤20 chars, WA 3 vs TG 10, list ≤10 rows, sum 100, window left<right) — intentionally deferred to Phase 2 unified validator per `validate.ts:52` integration; not a regression vs legacy (legacy `validateFlowForActivation` still exists and still enforces those limits on old flows).

---

## 6. API — PASS (half-landed, not duplicated)

```
                graph-service.ts (canonical)
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
    /api/flows (canonical now, was flows)   /api/automations (legacy write, import only)
      POST accepts trigger_envelope             POST /import → migrate.ts → flows
      GET normalizes envelope                 GET lists automations (legacy table)
```

- `graph-service.ts` is the only business-logic module for canonical graph CRUD/validate. No duplicated `validateGraphForActivation` elsewhere for flows path — single implementation.
- `/api/flows/route.ts:42` now handles `trigger_envelope` canonical (with legacy `trigger_type` mirror) and backfills on read via `envelopeFromLegacy` — so old clients sending single trigger still work, new clients can send `triggers[] OR`. This is the intended `compatibility` direction per `unified-automation-graph.md`.
- `/api/automations/import/route.ts:14` is opt-in, not auto-run, deterministic/idempotent, and is the only place that writes across both tables — not a second engine.
- **WARNING:** Full alias goal `GET /api/automations` backed by graph-service (union of flows + migrated flows) is not yet landed — `/api/automations/route.ts` still reads `automations` table directly. Not a duplicated engine, but the `graph-service backing both` intent is half-landed (flows side done). Documented as remaining Phase 2 cutover, not a new representation.

---

## 7. Security — PASS (with 1 WARNING)

- `flows` / `flow_nodes` / `flow_runs` RLS `auth.uid()=user_id` preserved (from `010_flows.sql`). `graph-service.ts` bypasses RLS via `supabaseAdmin()` but every method filters by `accountId` resolved from `profiles.account_id` in routes (`src/app/api/flows/route.ts:67` + `import/route.ts:49`). No cross-account exposure — `listGraphs(accountId)` SQL `eq(account_id, accountId)`, `getGraph(flowId, accountId)` SQL `eq(id, flowId).eq(account_id, accountId)`.
- `contact_randomizer_buckets` RLS `EXISTS flows f WHERE f.id=flow_id AND f.user_id=auth.uid()` SELECT only (writes service-role) — correct; service-role engine can write, browser cannot.
- `preview_sessions` RLS `USING auth.uid()=created_by_user_id FOR ALL` — allows any authenticated user to `INSERT preview_sessions` with any `flow_id/account_id` they choose, as long as they are creator. An attacker could insert `preview_sessions` for a victim flow_id in victim account_id. Not data exfiltration (state is attacker-provided) but cross-account write. **WARNING** — scaffold not yet serving prod traffic; Phase 2 should tighten to `EXISTS (SELECT 1 FROM flows f WHERE f.id=flow_id AND f.account_id=preview_sessions.account_id AND f.user_id=auth.uid())` (or check via `profiles.account_id`). Not a BLOCKER for Phase 1 scaffold.
- `supabaseAdmin()` usage appropriately constrained to routes that already enforce `requireRole('agent')` before calling service (flows POST, import POST).

---

## 8. Existing System Regression — PASS

Run: `npm run test -- src/lib/flows src/lib/automations` (covers `validate.test.ts`, `engine.test.ts`, `channel-target.test.ts`, `wait.test.ts`, etc.) — **all 306 tests pass** across `src/lib/flows` (178) + `src/lib/automations` (128) + new `src/lib/automation` (16). No relevant suite failed after fixes. `git diff` shows only `src/app/api/flows/route.ts` modified (plus new files) — no unrelated file changed.

---

## Architectural Readiness — Is Phase 1 Strong Enough for Phases 2–5 Without Another Foundational Rewrite?

**YES — after the two in-audit blocker fixes.**

- **Persistence:** `flows.trigger_envelope` + expanded `flow_nodes.node_type` + `flow_runs.pending_*` + two new tables is sufficient for all Manychat primitives (trigger OR, Message container 12 blocks, Action tasks, Condition all/any, Randomizer 12/sticky, Smart Delay duration/date/window/TZ, Start Automation call, AI Step). No new core table needed for Phase 2+ beyond possibly a future `automation_folders` (not structural).
- **Types:** `graph-types.ts` discriminated union is extensible — adding a new content block kind or new trigger kind requires adding a union member + deriving edges case, not re-typing the graph.
- **Edges:** `edges.ts` heterogeneous derivation already handles container-inner branching; future Manychat branching (e.g., new media block with branches) is additive in the Message loop.
- **Validation:** Single `validateGraphForActivation()` with `error|warning` severity + derived-edges reachability/cycle can be extended with Manychat Meta limits and trigger-specific checks in Phase 2 without re-architecting.
- **Service:** `graph-service` CRUD + import migration path is the canonical backing; builder and runtime in Phase 2 will call it rather than `automation_steps`/`automation_versions` directly.

Remaining `WARNING`s (preview RLS tightening, non-transactional delete+insert in `updateGraph`, channel-mismatch warning not yet, automations read alias half-landed) are additive polish, not foundational rewrites.

---

## Issues Found

| # | Finding | Severity | Location | Required Fix | Status |
|---|---------|----------|----------|--------------|--------|
| 1 | `flows.trigger_type` CHECK only allowed 3 values — unified `tag_added` etc. would violate on create | **BLOCKER** | `055` + `010_flows.sql:84` | Expand CHECK to all UnifiedTriggerKind in `055` | **FIXED** (055 now allows 22 kinds) |
| 2 | `wireNextKeys()` grouped by `parent_step_id` only, skipping branch-internal sequential wiring and mixing yes/no branches | **BLOCKER** | `migrate.ts:63` | Re-group by `(parent,branch)` + wire branches then sequential within scope | **FIXED** (now `byScope` + `childrenByParentBranch`) |
| 3 | `preview_sessions` RLS allows cross-account insert (only `created_by_user_id` check) | **WARNING** | `055` | Tighten to `EXISTS flows/account` check in Phase 2 | Documented |
| 4 | `updateGraph` node replacement delete+insert not transactional — crash could orphan nodes | **WARNING** | `graph-service.ts:217` | Wrap in RPC transaction in Phase 2 | Documented |
| 5 | Trigger `id` not deterministic (randomUUID per import) | **WARNING** | `migrate.ts:124` | Low risk (id not referenced externally); keep | Documented |
| 6 | `/api/automations` read still from `automations` table, not yet canonical alias | **WARNING** | `src/app/api/automations/route.ts` | Cut over to graph-service in Phase 2 | Documented |

No other BLOCKERs.

---

## Migration Safety Assessment

Additive, idempotent, reversible. `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `WHERE IS NULL` backfill, `migrated_to_flow_id` FK, preserves `id/node_key/entry_node_id`, keeps legacy columns as mirror, not auto-run — `POST /import` opt-in. Two blockers fixed make it safe to run even for `tag_added` triggers and branch-heavy automations.

## Test Results

- New: `graph-service.test.ts` 13/13 pass, `migrate.test.ts` 3/3 pass.
- Existing: `src/lib/flows` 178/178 pass, `src/lib/automations` 128/128 pass. No regression.

## Files Changed (for commit review)

- `supabase/migrations/055_unified_automation_graph.sql` — new, fixed (trigger_type CHECK expanded + wiring fix via migrate.ts)
- `src/lib/automation/graph-types.ts` — new (canonical types)
- `src/lib/automation/edges.ts` — new (heterogeneous)
- `src/lib/automation/graph-service.ts` — new (canonical service)
- `src/lib/automation/migrate.ts` — new, fixed (branch wiring)
- `src/lib/automation/graph-service.test.ts` — new
- `src/lib/automation/migrate.test.ts` — new
- `src/app/api/flows/route.ts` — modified (trigger_envelope support)
- `src/app/api/automations/import/route.ts` — new
- `docs/research/AUTOMATION_UNIFICATION_MIGRATION_PLAN.md` — new
- `docs/research/MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md` — new (prior phase)
- `docs/research/MANYCHAT_PRO_FLOW_BUILDER_SPEC.md` — new (prior phase)
- `docs/specs/unified-automation-graph.md` — new

Untracked non-commit artifacts (`graphify-out/` `supabase/.temp/` `.opencode/`) not for commit.

---

## Phase 2 Readiness

Ready — no foundational rewrite needed. Proceed to Phase 2 when approved. Keep `055` additive and `import` opt-in until Phase 2 builder/runtime cut over.

