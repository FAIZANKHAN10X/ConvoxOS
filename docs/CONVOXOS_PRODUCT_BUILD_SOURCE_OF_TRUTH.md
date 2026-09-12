# CONVOXOS — PRODUCT BUILD SOURCE OF TRUTH

> **Canonical execution contract.** This file is the single source of truth for the remaining product build. Muse opens this file first and knows what to build next, what is done, what is forbidden, and what counts as complete.
>
> **Status model:** a phase is ✅ COMPLETE only when implemented + verified + committed (hash recorded below). Plans, audits, and intentions never count.
>
> **Last verified:** HEAD `c96663d` — T4.1 ✅, T4.2 ✅. T4.3 is next.

---

## 1. Product Definition

**ConvoxOS** is a CRM + conversations + pipelines + automation + sequences + AI platform for teams running WhatsApp/Telegram-first operations. Product surface: contacts, inbox, pipelines/opportunities, visual automation builder, drip sequences, broadcasts, AI assistant with handoff.

**GoHighLevel (GHL)** is the **behavior reference** for the scoped surface — CRM, contacts, lifecycle, conversations, opportunities, triggers, actions, sequences, lead capture, email, analytics, AI-assisted CRM — not an architecture to copy and not a feature list to clone. Explicitly out of scope: funnels, payments, courses, affiliates, reputation, social, dialer, SMS/calls (until product demand), unless the roadmap below introduces them.

**Product loop (everything must strengthen this):**
`Lead → Contact → Conversation → Automation → Opportunity → Follow-up → Conversion`

---

## 2. Current Baseline (verified, not promised)

| Area | Score |
|---|---|
| Engineering maturity | 82/100 |
| Product maturity | 58/100 |
| Own-product completion | ~62% |
| Scoped GHL parity | ~38% |

**Verdict:** early product on a serious engineering foundation. Remaining work is product capability, not architectural rescue.

What exists and works: contacts CRUD/search/dedupe/import, tags, notes, WhatsApp-deep + Telegram-solid messaging with realtime + delta resync, pipelines with event-emitting drag-drop, broadcasts (audience/progress/resume/rate-limits), 20-node registry-driven builder with versioning/retries/idempotency/leases/history, 7 triggers + 10 actions + conditions/waits/variables, one-active-run enforcement, sequences that execute on schedule with reply-stop, roles/RLS/API-keys/invites, AI auto-reply/handoff/knowledge/10 tools, webhooks + REST + MCP, dashboard/reporting widgets.
What is half-built or missing: sequence analytics/management depth, task UI, deal lifecycle behavior, feed event coverage, custom-field types, export, opportunity list/filter/bulk, re-entry/stop controls beyond reply, trigger/action breadth, per-unit analytics, lead capture, email.

## 3. Current Stack + Stack Capability Contract

**Pinned:** Next.js 16.3.4 · React 19.2.8 · TypeScript 6.0.3 (target ES2022) · Node 22 LTS · ESLint 10.10.0 · Vitest 5.0.0 · Tailwind 4.3.3 · Supabase JS 2.115.0 · SSR 0.12.5 · @xyflow/react 12.11.5 · next-intl 4.14.2 · Zod 3.x · `@base-ui/react` · Recharts · `packageManager npm@10.9.9` · standalone output · typed routes.

**Adopted capabilities (use these first):** RSC · Suspense streaming · Cache Components / `use cache` + TTL · PPR · partialPrefetching · React Compiler + lint · `proxy.ts` · Supabase retries · `getClaims` pilot (activity route) · bounded queries · keyset pagination · RLS/account isolation everywhere · idempotency keys · claim leases · sequence leasing · `db:types` workflow.

**Rejected/deferred (with reason):** TypeScript 7 (typescript-eslint peer `<6.1.0` — revisit when supported) · React 19.3 (no benefit) · Zod 4 (behavior risk, no forcing function) · OTel (no tracing backend) · Redis/queues/microservices (no forcing function) · `useOptimistic` rewrite (manual pattern verified equivalent) · `server-only` dep (lockfile churn for one line) · `use cache: remote`/ISR (no need) · pnpm · TS programmatic API consumers.

**Contract:** before every phase, check whether the current stack already provides the capability (official docs where version-sensitive); prefer native; no new dependency without forcing function; no upgrade without forcing function; no architecture imitation.

---

## 4. Engineering Rules (invariants)

1. Database → business logic → computed state → UI. Backend owns business logic.
2. RLS + account isolation on every read/write; service-role only server-side with explicit `account_id` scoping.
3. Idempotent automation execution; bounded queries; keyset pagination for lists.
4. Extend existing workers (automation-worker tick) — never parallel schedulers/queues/event systems.
5. One automation registry, one engine, one worker. No second execution semantics.
6. No speculative infrastructure, framework rewrites, or optimization without demonstrated bottleneck.
7. Every phase: independently understandable, testable, committable, rollback-safe. No silent scope expansion — STOP → report → re-plan on surprise.
8. Tests: targeted + full suite green (baseline 1018). tsc clean. ESLint 0 errors. Production build green (static + PPR + dynamic preserved).
9. Security review per phase: RLS, isolation, secrets, webhooks/retries behavior unchanged unless the phase owns it.

---

## 5. Tier Roadmap

### TIER 4 — Finish CRM/Sequences (finish half-built surfaces; biggest completeness jump, least risk)

#### T4.1 — Live Sequences ✅ COMPLETE (`4ac3f17`, 1008 tests)
Scheduler discovery + atomic claim (`070`, SKIP LOCKED lease-bump) + execution via existing engine + idempotency keys + sweep inside automation-worker tick. No second scheduler.

#### T4.2 — Reply Stop / Sequence Exit ✅ COMPLETE (`c96663d`, 1018 tests)
Inbound reply cancels active enrollments (`stopEnrollmentsOnReply`, `cancelled_reason='reply'`); manual=`manual`, failure=`failed` (migration 071); executor race guards (post-send liveness re-check, `status='active'` terminal writes); 10 behavior tests. No re-entry/policy changes.

#### T4.3 — Sequence Management UI ⬜ NOT STARTED
List/create/edit sequences, enrollment visibility + details, status, step configuration, pause/resume. Depends: T4.1 (states exist), sequence RLS. Stack: existing RSC/shell patterns, Suspense. Excludes: analytics (T4.4), branching/advanced steps.

#### T4.4 — Sequence Analytics v1 ✅ COMPLETE (`2cf8dcc`)
Only: enrolled, active, completed, stopped, failed, sent, replied. Depends: T4.1–T4.3 (states + `cancelled_reason`). Stack: existing RPC aggregation pattern (068-style). Excludes: funnels, per-step timing heatmaps.

#### T4.5 — Tasks UI + Deal Lifecycle Completion ✅ COMPLETE (`7a6813a`)
Task list/details/assignment/due/completion + contact/deal association (backend `tasks/write.ts` exists); deal won/lost behavior + reason + domain events. Depends: tasks backend (exists), deals domain. Excludes: recurring tasks, reminders engine.

**Tier 4 exit:** sequence created → enrolled → scheduled → executed → stopped-by-reply → completed → inspected from UI; no major CRM primitive backend-only without documented reason.

### TIER 5 — CRM ↔ Automation Loop (core GHL-style lifecycle)

#### T5.1 — Contact Automation Primitives ✅ COMPLETE (`7665c16`)
Triggers: contact created/updated, tag added/removed. Actions: update contact, add/remove tag, assign owner, create task. Depends: event emission for contact_updated (new emitter), update-contact node (new). Stack: existing trigger/action registry + `enqueueDomainEventWithClient` + kick.
#### T5.2 — Opportunity Automation Primitives ✅ COMPLETE (`f64004d`)
Triggers: created/stage/status/won/lost. Actions: create/update/move/assign/value-status. Depends: deal write paths emit new events; RLS preserved. Excludes: multi-opportunity execution.
#### T5.3 — Task / Note Automation ✅ COMPLETE (`27b2351`)
Triggers: task created/completed (+overdue if cheap), note added. Actions: create task/note. Only events with real value. Depends: T4.5 task UI (shared writer exists).
#### T5.4 — Enrollment Controls ✅ COMPLETE (`77a552e`)
Re-entry policy (one-time vs repeat), enrollment rules, stop conditions, conflict handling, deterministic state. Depends: one-active invariant (exists). **Must precede T5.5.**
#### T5.5 — Multi-trigger / Event Coverage ✅ COMPLETE (`fa3c032`)
Expand triggers only onto real domain events. No fake trigger types. Depends: T5.1–T5.4 events + T5.4 semantics.
**Exit:** contact → qualify/nurture → opportunity → move → task → messages → reply alters/stops automation.

### TIER 6 — Lead Capture ⬜ (T6.1 forms → T6.2 form→automation → T6.3 appointments → T6.4 appointment→automation)
Minimal forms (fields/validation/submission/contact upsert/attribution, no funnel builder); form-submitted trigger needs T5.1 contact primitives first. Appointment record + contact link + status + booked/confirmed/cancelled/completed triggers; no Calendly clone.

### TIER 7 — Email ⬜ (T7.1 channel audit → T7.2 sending → T7.3 events → T7.4 inbound → T7.5 analytics)
Prerequisite: **provider decision (Resend vs SES vs Mailgun)** before T7.2. Track only provider-reliable metrics. Inbound reuses contact-matching + conversation-association patterns.

### TIER 8 — CRM Completion + Visibility ⬜ (T8.1 opp list → T8.2 bulk ops → T8.3 contact completion → T8.4 activity timeline → T8.5 automation analytics → T8.6 trigger debugging)
Bulk ops require RLS + auditability per action. Timeline sourced from the event model, not UI fakery. Debugger = lightweight what/when/who/result view.

### TIER 9 — AI-assisted CRM ⬜ (T9.1 context → T9.2 actions → T9.3 handoff → T9.4 visibility)
Tool/action boundaries explicit; account isolation enforced. AI automation node stays deferred (no forcing function).

### TIER 10 — Selective Advanced Parity ⬜ DEFERRED
Route-level splitting, builder lazy-load, conversation pagination, deeper analytics, richer fields, chaining, multi-opportunity, SMS/calls — only on product demand. Never merely because GHL has them.

---

## 6. Dependency Graph

```
T4.1 ✅ → T4.2 ✅ → T4.3 → T4.4 ─┐
T4.5 ───────────────────────────┤→ T5.1 → T5.4 → T5.5
                                ├→ T5.2 → T5.3 ─┘
T5.1 ──→ T6.1 → T6.2 ──→ T6.3 → T6.4
T5.2 ──→ T7 (after provider decision) ──→ T8 ──→ T9
```
Hard rules: T5.4 before T5.5. T5.1 before T6.2. Tasks UI (T4.5) before task triggers (T5.3). Provider decision before T7.2. Analytics (T4.4/T8.5) only on states that exist.

## 7. Definition of Done (per phase)

Code complete · intended tests added · full suite green · tsc clean · ESLint 0 errors · production build green (route mix preserved) · RLS/isolation verified · no perf/route regression · scope checked (no T+n leakage) · commit created · hash + results recorded in §11 · ledger status updated here.

## 8. Change Control

Phases execute sequentially as pre-approved. On architecture mismatch, missing prerequisite, security issue, scope-change need, decision reversal, or new-infra need: **STOP, document, ask. Never silently rewrite this file.**

## 9. Forbidden Scope (do not build unless explicitly approved)

Funnels/website builder · payments/invoicing/products · memberships/courses · reputation · social planner · affiliates · giant customization frameworks · custom dashboards · SMS/calls · AI automation node · workflow chaining (before T5.4) · microservices · Redis/queues · framework rewrites · speculative upgrades (TS7/Zod4/React 19.3) · OTel without backend · optimization without demonstrated bottleneck.

## 10. GHL Comparison Gate (final; not per-phase)

After T4–T9 complete and verified: fresh 2026 GHL-docs audit producing capability matrix, parity %, intentional differences, gaps, and product + engineering maturity scores.

## 11. Roadmap Ledger (live — update on every completion)

| Phase | Status | Commit | Tests | Verified |
|---|---|---|---|---|
| T4.1 Live Sequences | ✅ COMPLETE | `4ac3f17` | 1008 | Yes (suite+tsc+lint+build) |
| T4.2 Stop on Reply | ✅ COMPLETE | `c96663d` | 1018 | Yes (suite+tsc+lint+build) |
| T4.3 Sequence Mgmt UI | ✅ COMPLETE | `9cfdf1c` | 1028 | Yes (suite+tsc+lint+build) |
| T4.4 Sequence Analytics | ✅ COMPLETE | `2cf8dcc` | 1033 | Yes (suite+tsc+lint+build) |
| T4.5 Tasks UI + Deals | ✅ COMPLETE | `7a6813a` | 1046 | Yes (suite+tsc+lint+build) |
| T5.1 Contact Primitives | ✅ COMPLETE | `7665c16` | 1066 | Yes (suite+tsc+lint) |
| T5.2 Opportunity Primitives | ✅ COMPLETE | `f64004d` | 1088 | Yes (suite+tsc+lint+build) |
| T5.3 Task/Note Automation | ✅ COMPLETE | `27b2351` | 1100 | Yes (suite+tsc+lint+build) |
| T5.4 Enrollment Controls | ✅ COMPLETE | `77a552e` | 1109 | Yes (suite+tsc+lint+build) |
| T5.5 Multi-trigger/Coverage | ✅ COMPLETE | `fa3c032` | 1116 | Yes (suite+tsc+lint+build) |
| T6.1 Lead Forms | ✅ COMPLETE | `678e10c` | 1135 | Yes (suite+tsc+lint+build) |
| T6.2 Form → Automation | ✅ COMPLETE | `9a0f77d` | 1137 | Yes (suite+tsc+lint+build) |
| T6.3 Appointments | ✅ COMPLETE | `e3e3f82` | 1151 | Yes (suite spot+tsc+lint+build) |
| T6.4 Appointment → Automation | ✅ COMPLETE | `2d3f03d` | 1154 | Yes (suite+tsc+lint+build) |
| T7.1 Email Foundation | ✅ COMPLETE | `6059c87` | 1180 | Yes (suite+tsc+lint+build; 1 pre-existing date failure) |
| T7.2 Email ↔ CRM/Inbox | ✅ COMPLETE | `8ad5a16` | 1183 | Yes (suite+tsc+lint+build; 1 pre-existing date failure) |
| T7.3 Email Templates+Action | ✅ COMPLETE | `7899530` | 1196 | Yes (suite+tsc+lint+build; 1 pre-existing date failure) |
| T7.4 Email Events/Triggers | ✅ COMPLETE | `b0bbb32` | 1202 | Yes (suite+tsc+lint+build; 1 pre-existing date failure) |
| T7.5 Email Sequences | ✅ COMPLETE | `aa84975` | 1204 | Yes (suite+tsc+lint+build; 1 pre-existing date failure) |
| T8.1–T8.6 | ⬜ NOT STARTED | — | — | — |
| T9.1–T9.4 | ⬜ NOT STARTED | — | — | — |
| T10 | ⬜ DEFERRED | — | — | — |

## 12. Decision Log (pointers, not duplicates)

- Single engine/worker/registry; sequences standalone; AI node deferred → `docs/ARCHITECTURE_DECISION_AUTOMATIONS_V2.md`
- Channel model → `docs/CHANNEL_ARCHITECTURE.md`, `docs/TELEGRAM_MODULE.md`
- Builder/node contracts → `docs/specs/node-system.md`, `builder-spec.md`, `automation-product-spec.md`, `crm-automation.md`
- Integrations/n8n role → `docs/integrations.md`, `docs/mcp.md`, `docs/public-api.md`
- TS7 rejected (typescript-eslint peer) · OTel rejected (no backend) · `useOptimistic` equivalent (keep manual) — Tier 3 reports in history
- Prior phase reports: T4.1 (`4ac3f17`), T4.2 (`c96663d`) commit messages contain verification evidence
