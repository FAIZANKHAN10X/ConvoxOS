# HighLevel Workflow Builder — Product Model (Research: 2026-08-31)

> **Sources:** `https://help.gohighlevel.com/` primary. Accessed 2026-08-31.
> Classification: VERIFIED (official doc) / INFERRED / UNCERTAIN / NOT DOCUMENTED.

## 1. Core Mental Model — VERIFIED

HighLevel Workflow = **Trigger(s) → Actions (sequential)** automation attached to CRM objects.

- **One workflow can have multiple triggers** — "All triggers in the workflow will activate when their specific conditions are met." (`155000001254` Adding New Triggers). Contacts enter from any trigger source; triggers are OR not AND.
- **Actions run sequentially** in canvas order; advanced actions (Drip, Conditional, Goal) control flow but visually remain linear with branches.
- **Saved ≠ Published:** `VERIFIED` — "Saved and Published are not the same thing. The workflow can be saved or have unsaved changes and can be draft or publish, independent of each other." Red dot indicates unsaved. Draft = will not trigger; Publish = live. Waiting contacts **remain at current step when draft is resumed** (same doc Draft/Publish Toggle).
- **How to create:** Step 1 Choose Trigger → Step 2 Add Filters (optional) → Step 3 Add Actions. (`155000002288` Getting Started with Workflows).

## 2. Trigger Catalog — VERIFIED (full list from `155000002292`, modified 2026-06-19)

### 2.1 Categories (14)

Contact | Events | Appointments | Opportunities | Affiliate | Courses | Payments | Ecommerce Stores | IVR | Facebook/Instagram Events | Communities | Certificates | Communication | Google Ads

### 2.2 Complete List (verbatim UI labels)

**Contact (12):** Birthday Reminder, Contact Changed, Contact Created, Contact DND, Contact Tag, Custom Date Reminder, Note Added, Note Changed, Task Added, Task Reminder, Task Completed, Contact Engagement Score

**Events (21):** Inbound Webhook, Scheduler, Call Details, Email Events (delivered/opened/clicked/bounced/spam/unsubscribe), Customer Replied, Conversation AI Trigger, Custom Trigger, Form Submitted, Survey Submitted, Trigger Link Clicked, Facebook Lead Form Submitted, TikTok Form Submitted, Video Tracking, Number Validation, Messaging Error – SMS, LinkedIn Lead Form Submitted, Funnel/Website PageView, Quiz Submitted, New Review Received, Prospect Generated, Click To WhatsApp Ads, External Tracking Event

**Appointments (4):** Appointment Status (booked/rescheduled/canceled/no-show), Customer Booked Appointment, Service Booking, Rental Booking

**Opportunities (5):** Opportunity Status Changed (Open→Won/Lost), Opportunity Created, Opportunity Changed (field changes), Pipeline Stage Changed, Stale Opportunities (inactivity rule)

**Affiliate (4):** Affiliate Created, New Affiliate Sales (filters: affiliate/campaign/payout/tax), Affiliate Enrolled In Campaign, Lead Created

**Courses (12):** Category Started/Completed, Lesson Started/Completed, New Signup, Offer Access Granted/Removed, Product Access Granted/Removed, Product Started/Completed, User Login

**Payments (12):** Invoice (created/sent/due/paid), Payment Received, Order Form Submission, Order Submitted, Documents & Contracts (sent/signed/declined), Estimates (sent/accepted/declined), Subscription (create/update/pause/resume/cancel), Refund, Coupon Code Applied / Redemption Limit Reached / Expired / Redeemed

**Ecommerce Stores (6):** Shopify Abandoned Cart (Deprecating), Shopify Order Placed, Shopify Order Fulfilled (Deprecating), Order Fulfilled, Product Review Submitted, Abandoned Checkout

**IVR (1):** Start IVR Trigger

**Facebook/Instagram Events (2):** Facebook – Comment(s) On A Post, Instagram – Comment(s) On A Post

**Communities (5):** Group Access Granted/Revoked, Private Channel Access Granted/Revoked, Community Group Member Leaderboard Level Changed

**Certificates (1):** Certificates Issued

**Communication (2):** TikTok – Comment(s) On A Video, Transcript Generated

**Google Ads (1):** Google Lead Form Submitted

Plus **Company-Based Workflows** (`155000006688`): **Company Created**, **Company Changed** (field-value conditions) as Company-triggered workflows that can write to Company or associated Contacts. Also standalone Agency note: Triggers (legacy basic rules) doc `48000982202` confirms Triggers = Zap-like wiring connecting modules, now subsumed by Workflows.

### 2.3 Trigger Semantics per Trigger — INFERRED + VERIFIED fragments

| Concern | Behavior | Evidence |
|---------|----------|----------|
| **Filters** | Optional; refine when workflow should trigger (`155000002288` Step 2). Trigger-level stats: Attempted (evaluated) / Matched (met conditions) / Unmatched (did not). Click to drill per-contact, search, see why unmatched. 30-day window. | `155000001254` Stats View |
| **Re-entry / Multiple enrollment** | `VERIFIED` — Goal discussion: contacts can skip ahead; workflow with multiple triggers fires per matching event. Publisher notes: multiple workflows can receive same contact; `Add to Workflow` can re-enter. But "Workflow Builder prevents visual loops (arrows cannot return to a previous step), but it's possible to create non-visible loops" — re-entry via chaining is intended via Add to Workflow / Go To. Exact duplicate-suppression policy (e.g., contact enters same workflow twice) `UNCERTAIN` — not documented as blocked. |
| **Enrollment** | Trigger fires per event per contact/opportunity/appointment; not batch-time. Scheduler = time-based without contact. Inbound Webhook = external data POST. | `155000002292` |
| **CRM mutation on trigger** | Trigger itself is read-only; mutations happen via Actions downstream. | Inferred |

## 3. Action Catalog — VERIFIED (`155000002294`, modified 2026-06-03 + builder walkthrough)

### 3.1 Contact Actions (15)

Create Contact, Find Contact, Update Contact Field, Add Contact Tag, Remove Contact Tag, Assign to User, Remove Assigned User, Edit Conversation, Disable/Enable DND, Add Note, Add Task (creates contact-less task if workflow running without contact — pair with Inbound Webhook for internal tasks), Copy Contact (to another sub-account), Delete Contact, Modify Contact Engagement Score, Add/Remove Contact Followers.

### 3.2 Communication Actions (14)

Send Email, Send SMS, Send Slack Message, Call, Messenger (Facebook), Instagram DM, Manual Action, GMB Messaging, Send Internal Notification, Send Review Request, Conversation AI, Facebook Interactive Messenger, Instagram Interactive Messenger, Reply in Comments, WhatsApp, Send Live Chat Message.

### 3.3 Send Data (2)

Webhook/Custom Webhook (POST/GET/PUT/etc. to external URL), Google Sheets (lookup/update).

For Webhook (`155000003299`): Method selector, URL (critical), headers, custom data key/value with `{{contact.*}}`/`{{custom_fields.*}}` variables. Payload = Standard contact + sub-account data + **trigger-dependent data** (e.g., Appointment Booked → appointment start/calendar/status; Tag Added → no appointment/opportunity data). Testing: Test Workflow with contact → Execution Logs `Executed`. Format: context-dependent; must use correct trigger to get desired object data. Redirect: not followed (inferred from many integrations).

### 3.4 Internal Tools Actions (11)

If/Else (branch on conditions), Wait Step (delay), Goal Event, Split (A/B split test), Update Custom Value, Go To (direct to another workflow), Remove from Workflow, Arrays (find/filter/transform/calculate list data), Drip Mode (batch dripping to avoid rate limits), Text Formatter, Custom Code (execute script).

### 3.5 Workflow AI / Eliza / Appointments / Opportunities / Payments / Marketing / Affiliate / Courses / IVR / Communities

- **Workflow AI:** AI Prompt (GPT-3) — generate response from prompt.
- **Eliza:** Eliza AI Appointment Booking + Send to Eliza Agent Platform.
- **Appointments:** Update Appointment Status (rescheduled/no-show/completed), Generate One Time Booking Link.
- **Opportunities:** Create/Update Opportunity, Remove Opportunity (from specific/multiple pipelines).
- **Payments:** Stripe One-Time Charge (via `cus_id`), Send Invoice, Send Documents and Contracts, etc. (see full list in §3 preamble).
- **Marketing:** Add/Remove Facebook Custom Audience, Google AdWords/Analytics, Facebook Conversion API.
- **IVR:** Gather Input on Call, Play Message, Connect to Call, End Call, Record Voicemail.
- **Communities:** Grant/Revoke Group Access.
- **Courses/Affiliate:** Grant/Revoke Offer, Add/Update Affiliate, etc.

## 4. CRM ↔ Workflow — VERIFIED + INFERRED

HighLevel's workflow is **CRM-aware at object level** — workflows directly read/write:

| Object | Read in conditions? | Write via actions? | Trigger on changes? |
|--------|---------------------|--------------------|--------------------|
| **Contact** | Yes — Update Contact Field reads/tests in If/Else; filters on Contact Changed, Custom Date Reminder, etc. | Yes — Create/Update Contact, tags, DND, engagement score, followers | Yes — Created/Changed/DND/Tag/Custom Date/Note/Task |
| **Conversation** | Indirect via Customer Replied, Transcript Generated | Yes — Edit Conversation, Conversation AI, Manual Action, Live Chat, Messenger/IG/WhatsApp/SMS/Email | Yes — Customer Replied |
| **Opportunity** | Yes — Pipeline Stage Changed, Opportunity Changed filters include field/value conditions | Yes — Create/Update/Remove Opportunity | Yes — Status/Created/Changed/Stage/Stale |
| **Pipeline/Stage** | Via Pipeline Stage Changed trigger | Via Create/Update Opportunity → pipeline+stage selection | Yes — Stage trigger |
| **Task** | Yes — Task Added/Reminder/Completed triggers | Yes — Add Task (contact-less allowed) | Yes — Added/Reminder/Completed |
| **Note** | Yes — Note Added/Changed | Yes — Add Note | Yes — Added/Changed |
| **Appointment** | Yes — Appointment Status/Customer Booked filters | Yes — Update Appointment Status, Generate One Time Booking Link | Yes — Appointment Status/Booked/Service/Rental |
| **Assignment** | Yes — Assign to User / Remove Assigned User; visible in CRM | Via Assign to User / Remove Assigned User | Indirect via Conversation trigger |
| **Activity** | Not a first-class Activity feed object in docs — covered by Notes/Tasks/Opportunity history | Via notes/tasks | — |
| **Company** | Yes in Company-Based Workflows | Yes — Update Company / Create Associated Company, etc. | Yes — Company Created/Changed |

**Key semantics:**

- **Opportunity-aware:** Workflows can be **opportunity-scoped**: opportunity data (owner, pipeline, stage, value, status) only available if workflow has opportunity trigger (Pipeline Changed, etc.). Generic Tag Added workflow sends only contact-level data via Webhook. `VERIFIED` from Webhook payload doc.
- **Contact-less execution:** `Add Task` explicitly supports `creates a contact-less task if the workflow is running without a contact. Pair with Inbound Webhook to create internal tasks even when no contact exists.` `VERIFIED`.
- **History in CRM:** Workflow execution appears via Opportunity history / Contact timeline / Notes / Tasks created by workflow; plus Execution Logs in builder and Stats View. Not a single CRM timeline API but per-object.
- **Chaining:** `Add to Workflow` + `Go To` allow one workflow to enroll contact into another, carrying input trigger parameters (`Pass Input Trigger Parameters` passes original trigger fields — see §6 for detail). This is HighLevel's equivalent of ManyChat's Start Automation but richer (passes data).

## 5. Wait / Goals / Re-entry — VERIFIED

### 5.1 Wait (`Internal Tools > Wait Step`)

- **Types:** Implicitly duration-based inside Workflow Builder; no separate business-hours/SMS windows documented for Wait itself (business hours gating is via condition on Current Time or separate action). `UNCERTAIN` for full variant list vs ConvoxOS's minutes/hours/days.
- **Behavior:** Delays workflow for specific time; used for scheduling actions later. Drip Mode separately controls batch rate. Waiting contacts **remain at current step when workflow is set to Draft and resumed** — `VERIFIED` (`155000001254` Draft/Publish Toggle).

### 5.2 Goal Event (`Internal Tools > Goal Event`)

- **Purpose:** Direct contacts to a specific event goal, allowing them to **skip unnecessary steps**, optimizing journey. `VERIFIED` definition but configuration (which event defines goal, whether goal waits) `UNCERTAIN` from available docs — docs link to `155000003328` not fetched; inferred that reaching the defined event (e.g., appointment booked) fast-forwards past intermediate steps.

### 5.3 Re-entry & Loop Control

- **Multiple triggers per workflow:** All activate when conditions met → re-entry from different sources is intended.
- **Add to Workflow / Go To:** Explicit re-entry mechanism; `Add to Workflow` can `Pass Input Trigger Parameters` (original trigger fields) into receiving workflow; receiving workflow does **not need its own trigger** — it starts at first action assuming enrollment. `VERIFIED` from `155000002554`.
- **Loop prevention:** Builder "prevents visual loops (arrows cannot return to a previous step), but it's possible to create non-visible loops." `VERIFIED`. No documented automatic duplicate-suppression for same contact re-entering same workflow — user must design guards via conditions/tags.
- **Concurrency:** Multiple workflow instances per contact can run concurrently (Add to Workflow fans out). `INFERRED` — not blocked; execution identity is per workflow run (Execution Logs per workflow per contact).
- **Cancellation:** `Remove from Workflow` action explicitly removes contacts from workflow — targeted cancellation. Also disabling workflow (Draft) stops future triggers but leaves waiting contacts paused at step.

## 6. Workflow Builder UX — VERIFIED (`155000001254`, 2026-07-24)

- **Infinite Canvas:** Fit to Screen + Zoom In/Out bottom-left; Minimap bottom-right. Best practice: group related actions, keep workflow small enough to fit one screen.
- **Move nodes directly:** Hover → 6-dot drag handle → drag → `Move here` indicator. `VERIFIED`.
- **Workflow Switcher:** Left panel or `Shift+W` → search/scroll to switch workflows without leaving builder.
- **Adding triggers:** `Add New Trigger` → search + category filters, badges/app details to disambiguate. Configure trigger settings.
- **Adding actions:** Click `+` on workflow line → Actions panel right side. Search + categories (incl. Marketplace app actions with pricing/install info). Advanced types: Drip, Conditional, Goal flagged separately. Tip: meaningful names for Canvas clarity. Integration-powered steps show required fields locked until `Connect your account` → selector → unlock.
- **Stats View:** Toggle top-left. Triggers: Attempted/Matched/Unmatched (click → per-contact drill + search + why unmatched). Communication actions: delivery/engagement stats + detailed report. Workflow-level stats via expand arrow in list. Editing disabled in Stats View. Trigger Stats 30-day window. Note: deleting a communication action does not delete its stats.
- **Testing:** `Test Workflow` top-right → Select contact → Run Test → executes entire workflow for that contact including Webhook. Troubleshooting: check incomplete configs. Note: "Test Workflow using a contact isn't 100% perfect, especially if you reuse the same contact … ideally test by publishing and using it live." `VERIFIED`.
- **Saving:** `Save` top-right when red dot (unsaved changes). Errors on save if required fields incomplete. **Saved ≠ Published independent dimensions.**
- **Version History:** History icon top-right → view previous versions → `Back to Builder`.
- **Draft/Publish Toggle:** Top-right toggle. Draft = not trigger; Publish = live.
- **Keyboard shortcuts:** Standard Builder supports select/move/copy-paste/zoom/open panels/delete/save via shortcuts (full list in linked article, not fetched).
- **Workflow AI Assistant:** Helper to understand workflow and add right actions (linked article `155000003970` not fetched — `NOT DOCUMENTED` for detail).
- **Find & Replace Option:** Referenced as separate article (`155000007729`).

## 7. HighLevel AI Builder — Contract Only (from `155000001254` + `155000002294`)

- **Workflow AI Action:** `AI Prompt (GPT-3 Powered)` — generates AI response based on prompt for engagement automation. Appears as single action, not a canvas generator. Eliza actions handle AI appointment booking via Marketplace.
- **AI Assistant in Builder:** "You can also use Workflow AI Assistant to help understand the workflow and add the right actions." Detail not fetched — expected to suggest actions/nodes based on description; human review before publish implied by Save/Publish separation. `UNCERTAIN` for point-and-edit, undo scope, validation specifics vs ManyChat's 8-step chat flow. Do NOT replicate ManyChat AI chat UX; ConvoxOS AI should suggest workflow deltas via command palette pattern.

## 8. Implications for ConvoxOS

1. **Trigger parity gap is largest.** ConvoxOS has 5 automation triggers (`new_message_received, first_inbound_message, keyword_match, new_contact_created, conversation_assigned, tag_added, time_based, interactive_reply` — actually 8) vs HighLevel's 80+ across 14 categories. P0–P1: add Contact Changed/Created/DND/Tag, Note Added, Task Added, Appointment Status/Booked, Opportunity Status/Stage/Stale, Customer Replied, Inbound Webhook, Scheduler, Form Submitted, Call Details. Do NOT invent generic; port HighLevel's category names verbatim.
2. **Action parity gap second.** ConvoxOS has 12 automation actions vs HighLevel's 40+. P1: opportunity/pipeline actions need dedicated deal/pipeline tables (already have `pipelines/stages/deals`); task/note assignment needs task/note entities (currently `contact_notes` via migration 001 but no task table); appointment not present; community/course/ecommerce irrelevant for ConvoxOS scope.
3. **CRM-awareness missing guardrail:** HighLevel payload is trigger-dependent; ConvoxOS webhook `send_webhook` currently has no trigger-scoping warning — should surface payload availability per trigger.
4. **Testing & versioning:** HighLevel's Test Workflow (with contact selector) maps to ConvoxOS `dry-run` + `POST /api/automations/engine` already; add per-trigger stats (Attempted/Matched/Unmatched) and Version History (snapshot on save) as P2.
5. **Draft/Published independence + waiting preservation** already partially present (ConvoxOS has `is_active` but not separate `draft/published` vs `saved/unsaved`); waiting contacts preserved on draft is correct model to keep.
6. **Infinite canvas + switcher + minimap + drag handle** maps directly to ConvoxOS `@xyflow/react` already (Flow Builder uses xyflow; Automations uses builder-tree). No new canvas library needed.
