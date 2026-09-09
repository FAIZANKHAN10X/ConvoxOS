# Phase 7 Plan — Production Automation Completion

> **Status:** Pre-coding plan. No code yet in this commit. Graphify inspected `flows/engine`, `preview_sessions`, `flow_runs`, `ChannelSocket`, `sequences`, `automations` API, `flow_runs` events.
> **Invariant:** Canonical graph only (`flows`+`flow_nodes`), single runtime (`flows/engine`), no second message/action, no React business logic.


## Blockers Found (pre-coding)

None blocking. `preview_sessions` exists (055) but In-Messengers path is gated (blocked state) — requires server-side test-contact guard. Channel layer `ChannelSocket` already abstracted, no second abstraction needed. Sequences engine exists (`src/lib/sequences/engine.ts`) but not wired to condition — reuse, not rebuild.

## Priority Order (from spec, Phase 7)

### P0 — In-Messengers Testing (server-side protection mandatory)
- Extend `src/app/api/flows/[id]/preview/route.ts` `inmessengers` branch to actually verify `contactId` belongs to `accountId`, `flow` belongs to `accountId`, `channel` matches `contact` capability, then execute via `dispatchInboundToFlows` with test `providerMessageId = preview:test:${previewSessionId}` and `preview_sessions` as isolated run (do not create production `flow_runs` unless explicitly `preview` flag? Actually create preview-tagged run with `preview_session_id` in `pending_context` to isolate).
- Reuse `ChannelSocket` — real adapter but `preview` flag prevents `flow_runs` being counted in analytics (filter `preview_session_id IS NULL`).
- If credentials unavailable, return `blocked` with reason, not fake success.
- Add `preview_sessions` RLS already `auth.uid()=created_by_user_id` — add server check `account_id` match via `flows.account_id`.

### P1 — Dynamic + Messenger List (nested Message blocks)
- Keep `Message.content_blocks[]` — `dynamic` remains `Message.content_blocks[].kind=dynamic` with `request_type, url, headers, body, fallback_next`.
- Runtime: new `executeDynamicBlock(block, run)` that calls existing `make_external_request` infra (`fetch` via `src/lib/automations/engine` external request helper) — reuse, not new. Validate response JSON, convert `messages[]` array (Manychat `v2` dynamic format) into channel content via same `Message` block handling, send via `ChannelSocket`, on failure log `dynamic_failed` and follow `fallback_next` if configured, else `failed`.
- Messenger List: `messenger_list {list_id}` block — validate Messenger-only, store opt-in via `contact_custom_values` or `sequence_enrollments` (reuse), edge via `deriveEdges` already handles `messenger_list`? Need to add `messenger_list` edge derivation (currently not in `deriveEdges` — add `messenger_list` as non-branching, just opt-in).
- Keep nested, not top-level nodes.

### P2 — Sequences (minimum runtime)
- Reuse `src/lib/sequences/engine.ts` `enrollContactInSequence` / `unenroll`. Verify `Action tasks subscribe/unsubscribe` already calls it (via `src/lib/flows/engine.ts` action handler). Verify `Condition` `sequence` subject already implemented (Phase 5) — test with `sequence_enrollments`.
- No new scheduler — existing `sequences` engine handles drip via its own cron.

### P3 — Analytics (first useful surface)
- Use `flow_runs` + `flow_run_events` + `automation_pending_executions` — no new event system. Provide per-flow metrics: total runs, active/waiting, completed, failed, handed_off, messages sent (count `message_sent`), actions executed, condition branch counts, button selections (from `reply_received` + `message_sent` edges).
- Implement as `src/lib/automation/analytics.ts` aggregation over existing events, exposed via `GET /api/flows/[id]/analytics` (reuse, not new microservice). Do not alter runtime to generate analytics.

### P4 — Legacy API cutover (GET /api/automations)
- Inspect callers via Graphify `graphify query "GET /api/automations callers"`. If safe (tests show `migrated_to_flow_id` filtered, and `GET` is only listing), make `GET /api/automations` a compatibility projection: `SELECT flows WHERE account_id` + map to legacy shape `{id, name, trigger_type, is_active}` via `envelopeFromLegacy` reverse. Keep `POST /api/automations/import` for migration. If not safe (caller expects `automation_steps` shape), keep legacy read and document as compatibility API with `X-Canonical: flows` header.

### P5 — Safety audit + Failure observability (parallel)
- Audit `account_id` checks in `preview` preview, `ChannelSocket` (already checks `account_id`), `action` tasks (already `account_id` scoped), `contact_randomizer_buckets` (already `account_id`), `flow_runs` (already `account_id`).
- Failure: ensure every `catch` in `engine.ts` does `logEvent error` + `endRun failed` with `end_reason` and not silent. Already done for most, add for Dynamic and AI.

No new tables, no new engine, no React business logic.

