# Phase 8 Plan — Product Surface & Manychat Parity Completion

> **Status:** Pre-coding plan. No code yet in this commit. Graphify inspected `flow_runs`, `flow_run_events`, `analytics service`, `sequences`, `preview_sessions`, `flow editor`, `channel adapters`, `legacy /api/automations`.
> **Invariant:** Do not redesign canonical graph/runtime. No second analytics event system, no second Sequence engine, no second preview engine.

## Blockers

None blocking. `055` migration is idempotent, `analytics.ts` already aggregates `flow_runs`+`flow_run_events`, `sequences` engine exists, `preview_sessions` exists. Remaining work is product surface, not architecture.

## Priority Order (from spec)

### P0 — Analytics Product Surface
- Build `src/app/(dashboard)/flows/[id]/analytics/page.tsx` that calls `GET /api/flows/[id]/analytics` (already exists from Phase 7) and renders Overview: total/active/waiting/completed/failed/handed_off, messages sent, actions, condition branch distribution, button selections, with Convox design system cards. No BI, just per-flow overview + execution activity.

### P1 — Run / Execution Inspection
- Build `src/app/(dashboard)/flows/[id]/runs/[runId]/page.tsx` that loads `flow_run` + `flow_run_events` + `flow_nodes` and renders readable path: Trigger → Message (text preview) → Button: YES → Condition TRUE → Action → Smart Delay → Completed, with timestamps, waiting state, failure reason, current node, no secrets.

### P2 — Sequences Product Completion
- Verify `subscribe_sequence` / `unsubscribe_sequence` / `sequence` condition already use `src/lib/sequences/engine.ts` (Phase 7 did). Product loop: Automation → Subscribe → Sequence executes via its own cron → Contact state → Automation Condition observes `sequence_enrollments`. No new engine, just verify loop and document.

### P3 — Message Channel Rendering (Card/Gallery/Messenger List/Dynamic)
- Keep `Message.content_blocks[]`. Ensure `Card` (image+title+subtitle+buttons) and `Gallery` (≤10 cards) render via existing `preview-simulator` and runtime `dispatchChannelMedia` for Telegram, fallback text for WA where unsupported. `Messenger List` is Messenger-only — validation already warns, runtime logs. `Dynamic` already fetches and converts `messages[]`.

### P4 — Channel-specific UX
- Editor already shows `ChannelTargetRow` and `validateGraphForActivation` channel errors. Ensure `Message` container shows `channel_target` badge and validation message "not supported on Telegram" is visible in `validation-panel`.

### P5 — In-Messengers Finish Where Safe
- Current `preview/route.ts` does server-side verification (flow belongs to account, contact belongs to account, channel selected, credentials check) and returns `blocked` if no channel. For Phase 8, keep blocked state when credentials missing, do not fake delivery. If credentials present, the isolated run could be executed via `dispatchInboundToFlows` with `preview:test:` id, but to avoid polluting `flow_runs`, keep it as foundation with clear blocked state — document as safe.

### P6 — Legacy API Cutover
- Inspect callers via Graphify `GET /api/automations`. Current callers: `automations-client.tsx`, `automations/[id]/page.tsx` (unified), `mcp-server` tools. If safe, make `GET /api/automations` a compatibility projection: `SELECT flows WHERE account_id` + map to `{id,name,trigger_type,is_active}` via `envelopeFromLegacy` reverse. Keep `POST /api/automations/import` for migration. If not safe (shape mismatch for `automation_steps`), keep legacy read and document.

### P7 — Migration Cleanup, UX Polish, Lifecycle, Security, Performance
- Verify `055` idempotent, RLS correct, indexes appropriate, legacy columns retained for compatibility, new fields used. No cosmetic cleanup migration.
- UX polish: node editor consistency, validation visibility, save/activate states already in `flow-editor-state` + `header` + `ValidationPanel`.
- Lifecycle: Create→Edit→Save→Validate→Test→Activate→Execute→Wait→Resume→Complete→Inspect→Pause→Reactivate→Delete all via existing flows routes.
- Security: account/tenant isolation already via `account_id` checks in `preview` and `analytics` + RLS.

No new tables, no new engine.
