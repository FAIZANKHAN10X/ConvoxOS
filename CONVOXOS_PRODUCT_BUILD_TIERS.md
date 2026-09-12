# CONVOXOS — PRODUCT BUILD TIERS & STACK CAPABILITY PLAN

**Status:** Planning baseline — for execution status see the canonical ledger in `docs/CONVOXOS_PRODUCT_BUILD_SOURCE_OF_TRUTH.md` (T4.1 ✅ `4ac3f17`, T4.2 ✅ `c96663d`; that file, not this one, tracks completion).
**Purpose:** Controlled product development after Tier 1–3 performance/stack optimization  
**Rule:** Do not build blindly. Every future phase must first check whether the current stack already provides a capability that should be used.

---

# 1. PRODUCT DIRECTION

ConvoxOS is moving from **performance/engineering optimization** into **product capability development**.

The target is not to clone all of GoHighLevel.

The target is to build the CRM + Conversations + Pipelines + Automation + Sequences + AI product surface we actually want, using mature CRM patterns as the reference point.

GoHighLevel is the primary product benchmark for proven CRM/automation behavior.

The principle is:

> **Do not reinvent proven CRM primitives. Understand the capability, then implement our own clean version using our architecture and stack.**

---

# 2. CURRENT BASELINE

Current audited position:

| Area | Current Score |
|---|---:|
| CRM Foundation | 71/100 |
| Automation Engine | 68/100 |
| Channels | 55/100 |
| Sequences/Campaigns | 35/100 |
| AI Agents | 60/100 |
| Analytics/Product Polish | 45/100 |
| Own Product Completion | ~62% |
| Scoped HighLevel Parity | ~38% |
| Engineering Maturity | 82/100 |
| Product Maturity | 58/100 |

Current verdict:

**Early product on a serious engineering foundation.**

The main remaining work is product capability, not architectural rescue.

---

# 3. CURRENT STACK

## Frontend / Application

- Next.js 16.3.4
- React 19.2.8
- TypeScript 6.0.3
- Tailwind CSS 4.3.3
- @xyflow/react 12.11.5
- @base-ui/react 1.7.0
- Recharts 3.10.1
- next-intl 4.14.2
- Lucide
- Sonner
- date-fns
- @dnd-kit/*
- @dagrejs/dagre — removed

## Backend / Data

- Supabase
- PostgreSQL
- @supabase/supabase-js 2.115.0
- @supabase/ssr 0.12.5
- Row Level Security
- RPCs for bounded/high-value queries
- Server Actions / Route Handlers
- Realtime
- Storage

## Runtime / Tooling

- Node.js 22 LTS
- ESLint 10.10.0
- Vitest 5.0.0
- Playwright
- standalone Next.js output

## Next.js capabilities currently enabled/used

- React Server Components
- Suspense
- Streaming
- Cache Components
- `use cache`
- cache lifetimes / TTLs
- Partial Prerendering
- partial prefetching / Instant Navigation capability
- typed routes
- standalone builds

## React capabilities currently used

- RSC
- Suspense
- `use()`
- React Compiler linting
- client islands where interactivity is required

`useOptimistic` was evaluated and intentionally not required because the existing optimistic implementation is equivalent.

## Database / reliability capabilities already present

- RLS/account isolation
- idempotency
- claim leases
- retry behavior
- realtime resync
- delta synchronization
- bounded queries
- keyset pagination where appropriate
- soft-delete patterns
- audit fields
- JSON/JSONB metadata where appropriate

## Automation infrastructure already present

- Visual automation builder
- ~20 node types
- triggers
- actions
- conditions
- waits/delays
- variables
- execution history
- retries
- idempotency
- leases
- versioning
- enable/disable
- HTTP/webhook capabilities
- CRM-connected actions already present for tags, messages, deal movement, tasks and assignment
- AI conversation/handoff infrastructure

---

# 4. STACK CAPABILITY RULE

This document exists specifically to prevent this mistake:

> Build a feature manually → discover later that Next.js / React / Supabase / XYFlow already had a better native capability → retrofit it → create unnecessary complexity.

Before every implementation phase, Muse must perform a **Capability Check**.

For each planned feature:

1. Identify the desired behavior.
2. Check whether the current stack already provides a relevant capability.
3. Check official/current documentation where the capability is version-sensitive.
4. Determine whether the capability is:
   - already used
   - available but unused
   - unsuitable
   - requires an upgrade
   - requires external infrastructure
5. Prefer the native/current stack capability when it materially improves correctness, simplicity, performance or maintainability.
6. Do not introduce a new dependency merely because it is convenient.
7. Do not upgrade a dependency without a forcing function.
8. Do not redesign architecture to imitate another product.

Every implementation plan must contain:

### STACK CAPABILITY CHECK

- Existing capability:
- Stack feature:
- How it should be used:
- Why it is preferable:
- New dependency required: yes/no
- Stack upgrade required: yes/no
- Infrastructure required: yes/no
- Risk:
- Decision:

---

# 5. PRODUCT BUILD TIERS

The tiers are intentionally dependency-oriented.

A tier should be considered complete only when its phases are complete and verified.

---

# TIER 4 — MAKE THE EXISTING CRM/SEQUENCE SYSTEM ACTUALLY COMPLETE

**Goal:** Finish the half-built capabilities already represented in the product.

This tier should create the biggest immediate jump in product completeness with the least architectural risk.

## T4.1 — Live Sequences

Build:

- sequence scheduler
- enrollment execution
- delayed step execution
- scheduled sends
- per-step send records
- retry behavior
- failure handling
- enrollment state
- sequence completion
- pause/resume
- cancellation

Important:

The existing sequence engine/schema should be reused.

Do not create a second scheduling/execution system.

### Stack check

Investigate existing background-job/scheduling infrastructure before implementation.

Use the simplest reliable scheduler available to the current architecture.

---

## T4.2 — Reply Stop / Sequence Exit

Build:

- stop sequence when contact replies
- explicit exit conditions
- enrollment cancellation
- completed/failed/stopped states
- deterministic behavior when a reply races with a scheduled step

Must preserve idempotency.

---

## T4.3 — Sequence Management UI

Build:

- sequence list
- create/edit
- enrollment visibility
- status
- step configuration
- pause/resume
- enrollment details
- basic execution visibility

---

## T4.4 — Sequence Analytics v1

Build only useful metrics:

- enrolled
- active
- completed
- stopped
- failed
- sent
- replied

Avoid building an analytics monster.

---

## T4.5 — Tasks UI + Deal Lifecycle Completion

Finish existing backend capabilities:

- task list
- task details
- assignment
- due dates
- completion
- contact/deal association
- deal won/lost behavior
- win/loss reason where appropriate
- corresponding domain events

### Tier 4 exit condition

A sequence can be created, enrolled, scheduled, executed, stopped by reply, completed, and inspected from the UI.

No major existing CRM primitive remains "backend-only" without an explicit reason.

---

# TIER 5 — CRM ↔ AUTOMATION LOOP

**Goal:** Make the automation engine genuinely control the CRM instead of merely operating beside it.

This is the core HighLevel-style CRM automation relationship.

## T5.1 — Contact Automation Primitives

Triggers:

- contact created
- contact updated
- tag added
- tag removed

Actions:

- update contact
- add/remove tag
- assign owner
- create task

---

## T5.2 — Opportunity Automation Primitives

Triggers:

- opportunity created
- stage changed
- status changed
- won
- lost

Actions:

- create opportunity
- update opportunity
- move stage
- assign owner
- update value/status

Must support existing RLS/account boundaries.

---

## T5.3 — Task / Note Automation

Triggers:

- task created
- task completed
- task overdue where useful
- note added

Actions:

- create task
- create note

Only implement events that have real product value.

---

## T5.4 — Automation Enrollment Controls

Build:

- re-entry policy
- one-time vs repeat enrollment
- explicit enrollment rules
- stop conditions
- conflict handling
- deterministic enrollment state

---

## T5.5 — Multi-trigger / Event Coverage

Expand the event system only after the underlying CRM events are real.

Every trigger must correspond to a real domain event.

Do not create fake trigger types.

### Tier 5 exit condition

A user can build a real CRM lifecycle:

**contact enters → automation qualifies/nurtures → CRM changes → opportunity created → opportunity moves → follow-up task created → messages sent → reply can alter/stop automation.**

This is the core loop.

---

# TIER 6 — LEAD CAPTURE + TOP OF FUNNEL

**Goal:** Stop requiring every CRM record to enter manually.

## T6.1 — Forms v1

Build minimal lead-capture forms:

- fields
- validation
- submission
- contact creation/update
- source attribution
- basic form management

Do not build a full website/funnel builder.

---

## T6.2 — Form → Automation

Support:

- form submitted trigger
- contact creation/update
- automation enrollment
- tags
- opportunity creation
- follow-up

---

## T6.3 — Appointment Primitive

Build only the CRM-connected appointment model:

- appointment record
- contact relationship
- status
- scheduled time
- cancellation
- basic event triggers

Do not build a Calendly clone.

---

## T6.4 — Appointment → Automation

Triggers:

- appointment booked
- appointment confirmed
- appointment cancelled
- appointment completed/no-show where justified

Actions:

- send message
- create task
- update contact
- move/create opportunity

### Tier 6 exit condition

A lead can enter through a form or appointment, become a CRM contact, enter automation, and progress toward an opportunity.

---

# TIER 7 — EMAIL + COMMUNICATION EXPANSION

**Goal:** Expand communication beyond WhatsApp/Telegram without compromising the existing channel architecture.

## T7.1 — Channel Abstraction Audit

Before implementation:

- inspect current channel interfaces
- determine what is genuinely shared
- identify channel-specific behavior
- avoid forcing every channel into identical semantics

---

## T7.2 — Email Sending

Build:

- outbound email
- templates
- contact personalization
- delivery state
- failure/retry
- automation action
- conversation association where appropriate

---

## T7.3 — Email Events

Support useful events:

- delivered
- bounced
- opened where reliable
- clicked where reliable
- replied

Only track metrics that the provider can reliably supply.

---

## T7.4 — Email Reply → CRM

Build:

- inbound email
- contact matching
- conversation creation/association
- reply trigger
- automation interaction

---

## T7.5 — Email Analytics v1

Basic:

- sent
- delivered
- failed
- replied

Avoid vanity metrics unless they have product value.

### Tier 7 exit condition

Email behaves like a first-class CRM communication channel and participates in automation.

---

# TIER 8 — OPPORTUNITY / CRM COMPLETION + OPERATIONAL VISIBILITY

**Goal:** Finish the CRM surfaces so users can actually operate the system at scale.

## T8.1 — Opportunity List View

Build:

- list/table view
- search
- filters
- sorting
- stage/status filtering
- owner filtering

---

## T8.2 — Bulk CRM Operations

Where safe:

- bulk assignment
- bulk tags
- bulk stage changes
- bulk status changes
- bulk task creation

Every bulk action must respect RLS and auditability.

---

## T8.3 — Contact Completion

Build:

- lifecycle/status
- owner
- richer custom field types
- notes editing
- export

Do not introduce unnecessary custom-field complexity.

---

## T8.4 — Activity Timeline Completion

Ensure important real events appear:

- contact updated
- opportunity created
- stage changed
- automation executed
- tasks
- notes
- messages

The event model should be the source of truth rather than UI-only fake activity.

---

## T8.5 — Automation Analytics

Build:

- executions
- success/failure
- step performance
- trigger counts
- active runs
- stopped runs
- error visibility
- basic funnel view

---

## T8.6 — Event / Trigger Debugging

Build a lightweight operational view showing:

- what triggered
- when it triggered
- which contact
- which automation
- execution result
- failure reason
- relevant IDs

This is more valuable than a giant debugger.

### Tier 8 exit condition

CRM users can find, filter, manage, bulk-operate and understand their contacts/opportunities/automation activity without relying on raw database knowledge.

---

# TIER 9 — AI-ASSISTED CRM

**Goal:** Connect the existing AI conversation system more deeply to CRM operations.

AI automation nodes remain intentionally deferred until there is a forcing function.

## T9.1 — AI + CRM Context

AI should be able to use appropriate:

- contact information
- conversation history
- tags
- opportunities
- relevant notes
- activity context

Respect account isolation and permissions.

---

## T9.2 — AI CRM Actions

Allow AI to safely perform approved actions such as:

- update contact
- add/remove tag
- create task
- create/update opportunity
- move opportunity
- handoff to human

Use explicit tool/action boundaries.

---

## T9.3 — Human Handoff

Complete:

- handoff state
- summary
- owner notification
- conversation context
- return-to-AI behavior where appropriate

---

## T9.4 — AI Operational Visibility

Track:

- AI response
- tool/action
- result
- failure
- handoff

Do not build a giant AI analytics platform.

### Tier 9 exit condition

AI is not merely a chatbot. It can understand CRM context and safely participate in CRM operations.

---

# TIER 10 — POLISH, SCALE & SELECTIVE PARITY

Only begin this tier after the core product loop is proven.

Possible work:

- route-level JS/code splitting
- builder canvas lazy loading
- conversation pagination/infinite loading
- deeper analytics
- better bulk operations
- richer custom fields
- improved channel features
- advanced sequence branching
- workflow chaining
- multi-opportunity behavior
- SMS if product demand justifies it
- calls if product demand justifies it

These are deliberately later.

Do not build them merely because HighLevel has them.

---

# 6. WHAT WE ARE NOT BUILDING YET

Explicitly out of the current roadmap:

- full HighLevel clone
- funnels/website builder
- payments/invoicing/products
- memberships/courses
- reputation management
- social planner
- affiliate system
- giant CRM customization framework
- custom dashboards before demand exists
- SMS/calls before email/product demand justifies them
- AI automation node before the CRM/automation loop is mature
- workflow chaining before enrollment/re-entry semantics are mature
- unnecessary microservices
- Redis/queue replacement unless a real forcing function appears
- framework rewrites
- speculative dependency upgrades

---

# 7. HIGHLEVEL BENCHMARK RULE

HighLevel is a **product behavior reference**, not our architecture.

For every major feature:

1. Research current HighLevel behavior.
2. Identify the user problem it solves.
3. Identify the minimum capability required.
4. Map that capability onto ConvoxOS.
5. Check our existing schema/events/automation engine.
6. Check current stack capabilities.
7. Design the simplest ConvoxOS-native implementation.
8. Test it.
9. Compare behavior again.

Do not copy unnecessary complexity.

---

# 8. PHASE CONTROL RULES

Every phase must be:

- independently understandable
- dependency-aware
- limited in scope
- independently testable
- independently committable
- rollback-safe

A phase must NOT silently expand into another phase.

If implementation discovers a dependency not covered by the plan:

**STOP → report → re-plan.**

Do not improvise architecture mid-phase.

---

# 9. MUSE WORKFLOW

Muse is primarily responsible for:

- codebase inspection
- Graphify exploration
- current-stack capability research
- HighLevel behavior research
- architecture review
- implementation planning
- verification/auditing

When asked to implement, Muse must first:

### STEP 1 — GRAPHIFY

Use Graphify to map relevant modules and dependencies.

### STEP 2 — STACK CAPABILITY CHECK

Check whether the current stack already provides a relevant capability.

### STEP 3 — PRODUCT REFERENCE

Compare the intended behavior against current HighLevel CRM/automation behavior.

### STEP 4 — PLAN

Produce a controlled phase plan.

### STEP 5 — IMPLEMENT

Only after explicit instruction.

### STEP 6 — VERIFY

Run:

- targeted tests
- full test suite
- TypeScript
- ESLint
- production build
- relevant runtime checks

### STEP 7 — REPORT

Report:

- what changed
- files changed
- tests
- capability decisions
- HighLevel parity gained
- remaining gaps
- commit hash

Then STOP.

---

# 10. DEFINITION OF DONE

A feature is not considered complete because:

- a route exists
- a component exists
- a database table exists
- a type exists
- a node appears in the builder

A feature is complete only when:

**UI → API/server logic → database/domain state → events → automation → persistence → error handling → permissions → tests**

are coherent for the intended behavior.

Where a layer is intentionally absent, document why.

---

# 11. TARGET PRODUCT EVOLUTION

The intended progression is:

### Current

**CRM + WhatsApp/Telegram + Pipelines + Automation Core + AI**

↓

### Tier 4

**Sequences become real + existing CRM surfaces completed**

↓

### Tier 5

**CRM ↔ Automation lifecycle becomes real**

↓

### Tier 6

**Leads can enter the system automatically**

↓

### Tier 7

**Email becomes a first-class CRM channel**

↓

### Tier 8

**CRM becomes operationally complete and observable**

↓

### Tier 9

**AI becomes CRM-aware and operational**

↓

### Tier 10

**Selective advanced parity / scale / polish**

---

# 12. FINAL PRINCIPLE

The goal is not maximum feature count.

The goal is a coherent CRM system where:

**Lead → Contact → Conversation → Automation → Opportunity → Follow-up → Conversion**

works as one connected product.

Every future feature should strengthen that loop.

If a feature does not strengthen the product loop, solve a real operational problem, or create meaningful competitive value, it should be questioned before being built.

**Build product capability now. Optimize only when evidence demands it.**
