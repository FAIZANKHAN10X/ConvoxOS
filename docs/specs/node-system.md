# ConvoxOS Node System — Behavioral Contracts (2026-08-31)

> Source: `docs/research/manychat-model.md` + `highlevel-model.md` + `channel-behavior.md` + `docs/specs/automation-product-spec.md` + `builder-spec.md`.
> Taxonomy: `UNIFIED_CATEGORIES` in `src/lib/automations/unified-taxonomy.ts:31` → **communication | input | logic | timing | crm | integration | control**. Do not invent a new taxonomy without audit evidence.
> Every node below defines: visual, schema, required/optional, inputs/outputs/branches, channel support, CRM effects, runtime, failure, validation, testing, execution state, serialization, analytics, reusability. Where ManyChat/GHL diverges, ConvoxOS decision is noted as **ConvoxOS contract**.

## 0. Node Contract Template

Each card follows the 25-field structure from the brief §8 adapted to ConvoxOS persistence (Flow `config JSONB` vs Automation `step_config JSONB`). Fields marked `VERIFIED` come from official docs; `CURRENT` = already implemented; `TARGET P*` = required gap.

---

## 1. TRIGGERS — Starting Step (not a graph node but envelope)

TRIGGERS gate enrollment. One envelope per automation with one `trigger_type` today; target supports multiple triggers OR (GHL) as P2.

| Field | Contract |
|-------|----------|
| **Name** | Trigger — Starting Step |
| **Category** | TRIGGERS |
| **Visual** | Rounded pill at graph top, shows trigger icon + summary (e.g., `Keyword: support,help` + channel chip `Any/WA/TG`). ManyChat: dark Starting Step; GHL: Add New Trigger button + chip list. ConvoxOS: `TriggerPanel` chips. |
| **Config UI** | Picker: trigger type → type-specific form. All types expose `channel: any|whatsapp|telegram` where conversational (already `Flow TriggerPanel` + `Automation trigger_config.channel`). Filters: keyword list + match_type + case_sensitive; tag_id; schedule; reply_ids. |
| **Required** | `trigger_type` enum; per-type required (keyword: `keywords≥1`; tag_added: `tag_id`; interactive_reply: `reply_ids≥1`; time_based: `schedule`). Channel optional (any = no filter). |
| **Optional** | `channel`, `case_sensitive`, `match_type` default `contains` (flows) / `contains` (automations). |
| **Variables** | None captured; defines `AutomationContext.trigger_channel` / `flow_runs.trigger_channel` snapshot for downstream `current`. |
| **Inputs/Outputs** | No inputs; single output to `entry_node_id` (Flows) / first step position 0 (Automations). |
| **Branches** | None. |
| **Connection semantics** | Entry pointer dereferenced at dispatch. `triggerChannelMatches` verifies `channel` filter before enrollment (`src/lib/flows/engine.ts:190`, `src/lib/automations/engine.ts:759`). |
| **Channel support** | Filter restricts which inbound channel can enroll; non-conversational triggers (tag_added, manual) have no channel snapshot — `current` downstream resolves to error unless explicit. |
| **Validation** | `validateFlowForActivation` trigger check + `validateTriggerForActivation` keyword/reply_ids non-empty. Missing channel not error (defaults any). |
| **Runtime** | `dispatchInboundToFlows` `findEntryFlow` matches `entryTriggerTexts` (text + reply_title + reply_id deduplicated) then `matchesKeywordTrigger`; Automations `triggerMatches` per-type check incl channel. `runAutomationsForTrigger` verifies contact ownership before steps (`engine.ts:96`). |
| **Failure** | No match → `no_match` (flows fall through to automations). Invalid channel filter → never fires — warning severity not error. |
| **Testing** | Not executed in quick preview (ManyChat VERIFIED). Full test via selected contact still requires live evaluation — preview manual. |
| **Execution state** | Not a run state; only gates enrollment. `last_executed_at` bump on success via RPC increment counter. |
| **Serialization** | `flows.trigger_type/trigger_config JSONB` + `entry_node_id`; `automations.trigger_type/trigger_config JSONB`. `channel` inside config. |
| **Reusability** | Trigger not reused standalone; Start Automation reuses callee trigger's enrollment semantics. |
| **Gap** | P1: add `contact_created/changed, note_added, appointment_status, opportunity_status/pipeline_stage_changed, customer_replied, inbound_webhook, scheduler`. P2: multiple triggers per automation OR. |

### 1.1 Trigger type catalog (target)

| Type | When it fires | Config | Channel filter | Re-entry |
|------|---------------|--------|----------------|----------|
| `keyword` / `keyword_match` | inbound `text` or `reply_title/reply_id` contains/exact/word match | keywords[], match_type, case_sensitive | yes | per message |
| `first_inbound_message` | contact's first inbound (isFirstInboundMessage flag) | (none) + optional channel | yes | once per contact |
| `manual` | human/system enroll | (none) | no | on demand |
| `tag_added` | `contact_tags` insert | tag_id | no | per tag add (guarded by depth) |
| `interactive_reply` | reply_id match | reply_ids[] | yes | per tap |
| `contact_created/changed` | contacts insert/update | field whitelist + values | no | per change |
| `customer_replied` | any inbound irrespective of keyword | (optional channel) | yes | per reply |
| `appointment_status` | calendar status change | status enum | no | per change |
| `opportunity_*` | deal pipeline changes | pipeline_id/stage_id/status | no | per change |
| `inbound_webhook` | POST to workflow webhook URL | URL | no | per call |
| `scheduler` / `time_based` | cron/time | schedule, timezone | no | per tick |

---

## 2. COMMUNICATION — Send nodes

All send nodes resolve `ChannelTarget` via `resolveChannelTarget(rawTarget, triggerChannel)` (`flows/engine.ts:175`, `automations/engine.ts:63`, `socket.ts:222`): legacy null → `whatsapp`, `current → snapshot else null→error channel_target_missing`, explicit `whatsapp|telegram` → that. No silent default beyond legacy compat. Builder requires channel (`validateOne` channel_target required).

### 2.1 Send Message (Text)

| Field | Contract |
|-------|----------|
| Visual | Card with message icon + channel chip + text preview truncated 120 chars + next arrow. |
| Schema (Flow) | `SendMessageNodeConfig { text: string, next_node_key: string, channel_target?: ChannelTarget }` (`types.ts:30`). Interpolation `{{vars.X}}`. |
| Schema (Automation) | `SendMessageStepConfig { text: string, channel_target?: AutomationChannelTarget }` (`types/index.ts:535`). Interpolation `{{vars.*}}` / `{{message.text}}`. |
| Required | `text` non-empty after `interpolateVars` trim; `next` / position ordering; `channel_target`. |
| Optional | none (text is body). |
| Inputs | 1 |
| Outputs | 1 sequential (`next_node_key` / next position). |
| Channel | Text supported on WA+TG both (TG 4096 cap). Hidden nowhere. |
| CRM effects | None direct. Creates `messages {channel, content_type=text, status=sent}` + `conversations.last_message_*` bump. |
| Runtime | `advanceFromNodeKey` → `dispatchChannelText({channel,target,text})` (`flows/engine.ts:718`, `automations/engine.ts:391`) → ChannelSocket → provider. Logs `message_sent` with providerMessageId. On TG: optional `inlineKeyboard` passthrough (not used for plain text). |
| Failure | Empty text → runtime `send_message has empty text` before dispatch. `channel_target_missing` → fail run with error log. Provider `ChannelSocketError` → `send_text_failed` → end `failed`. |
| Validation | `validateFlowForActivation:220` text required, channel required; `validateStepsForActivation:62` same. Publish blocks. |
| Testing | Both preview modes show text bubble. |
| Execution state | Auto-advances; not a wait state. `node_entered → message_sent` events. |
| Serialization | `config.text` + `channel_target` inside node JSONB / step_config. |
| Analytics | Sent count per node (stats). |
| Reusability | Picker `send_message` both hosts (`unified-taxonomy.ts:94`). |

### 2.2 Send Buttons

| Field | Contract |
|-------|----------|
| Visual | Card with `Text + 1–3 (WA) / 1–10 (TG) buttons` rows each with title + reply_id + next arrow branch handle. |
| Schema | Flow `SendButtonsNodeConfig { text, header_text?, footer_text?, buttons:[{reply_id,title,next_node_key}], channel_target? }` (`types.ts:39`). Automation `SendButtonsStepConfig = InteractiveMessagePayload & {channel_target}` (`types/index.ts:545`) where payload `kind=buttons`. |
| Required | `text` (body); `buttons` ≥1; each `reply_id` non-empty unique, `title` non-empty ≤20, `next_node_key` exists. `channel_target`. |
| Optional | `header_text`, `footer_text`. |
| Inputs | 1 |
| Outputs | N button branches (each `next_node_key` is an edge). |
| Channel | WA 1–3, TG 1–10 (ManyChat VERIFIED). Card/Gallery buttons separate but same limit semantics. |
| CRM | None beyond message row. |
| Runtime | Channel-aware suspend. TG: `dispatchChannelText` with `inline_keyboard: buttons.map(b=>[{text:b.title, callback_data:b.reply_id}])`; WA: `engineSendInteractiveButtons`. Sets `last_prompt_message_id` for thread quoting. Suspends — `advanceCurrentNodeKey` stores `current_node_key` (Flows) / branch (Automations uses trigger chaining not suspension for buttons outside Flow). Resume via `matchReplyId(currentNode, incoming.reply_id)` (`engine.ts:75`). |
| Failure | Duplicate `reply_id` → validation error. `channel_target_missing` → error. Telegram `callback_data` 1–64B + https URL check (enforced in `keyboard.ts` validate). Provider failure → `send_text_failed` / `send_buttons` fail. |
| Validation | `validateFlowForActivation:334` 1–3 check (BUG: WA-only limit) + per-button checks + channel required. `validateStepsForActivation:79` via `validateInteractivePayload(c)` (WA limits) — see P0 gap. Must become channel-aware: WA ≤3 else TG ≤10. |
| Testing | Quick preview shows buttons as tappable pills (Flow preview widget). Full test requires native app login for TG inline keyboard tap. |
| Execution state | Suspending — `active` + `current_node_key = this node` — stats `Waiting`. Next inbound matched advances; else fallback/reprompt branch. |
| Serialization | Buttons array with `reply_id/title/next_node_key` inside config; edges implicit in array. Clone preserves node_keys. |
| Analytics | Per-button tap counts (future). |
| Reusability | Both hosts. |
| **P0 mismatch** | Builder validates TG buttons against WA cap (≤3) → blocks valid TG 4–10 builds. Fix: `validateFlowForActivation` / `validateInteractivePayload` branch on `channel_target`. Likewise Automation path maps WA shape→TG inline keyboard at runtime (`automations/engine.ts:417`) correctly, but validation rejects before it. |

### 2.3 Send List

| Field | Contract |
|-------|----------|
| Visual | Card with `text + button_label (tap-to-expand) + sections[title? + rows[reply_id/title/description/next]]`. |
| Schema | Flow `SendListNodeConfig { text, button_label, sections:[{title?, rows:[{reply_id,title,description?,next_node_key}]} ], channel_target? }` (`types.ts:56`). Automation `SendListStepConfig` same shape (`kind=list`). |
| Required | `text`, `button_label`, `sections` ≥1 row total; per-row `reply_id` unique, `title` ≤24, `description` ≤72 (INTERACTIVE_LIMITS). |
| Optional | `header_text`, `footer_text`, section title, row description. |
| Inputs | 1 |
| Outputs | M row branches (each row's `next_node_key`). |
| Channel | WA native list (≤10 rows). TG: flattened to inline keyboard rows (`flatMap section.rows→button`) (`flows/engine.ts:517`). |
| Runtime | Same suspend path as buttons but uses `engineSendInteractiveList` (WA) vs inline keyboard (TG). |
| Validation | `validateFlowForActivation:444` 1–10 rows total, per-row checks, channel required. TG path same P0 gap (WA row limits incorrectly applied). |
| Failure | Same as buttons + list caps. |
| Execution state | Suspending. |

### 2.4 Send Media

| Field | Contract |
|-------|----------|
| Visual | Card with media preview (image thumb / video play / doc icon) + optional caption + filename for doc + next arrow. |
| Schema | Flow `SendMediaNodeConfig { media_type: image|video|document, media_url: string, caption?, filename?, next_node_key, channel_target? }` (`types.ts:88`). No automation host yet (flows-only per taxonomy). |
| Required | `media_type` ∈ {image,video,document}; `media_url`; `next`. |
| Optional | `caption` (≤ INTERACTIVE_LIMITS.bodyMaxLength), `filename` (doc only, defaults to upload original). |
| Inputs | 1 |
| Outputs | 1 |
| Channel | WA: image|video|document|audio (via socket `voice→audio` mapping) — `socket.ts:143` caps. TG: image|document|video|audio|voice via `sendTelegramMedia` (caption 1024). Not in ManyChat TG blocks beyond Image/Audio/Video/File — document maps to File. |
| Runtime | `dispatchChannelMedia {mediaKind, mediaUrl, caption, filename}` (`flows/engine.ts:756`). TG uses public `chat-media/telegram/` URL; WA same bucket. Caption interpolated. |
| Validation | `validateFlowForActivation:263` media_type+media_url+captions caps. |
| Failure | Missing URL → error. Caption too long → error. Provider media upload/fetch failure → `send_media_failed`. |
| Execution state | Auto-advances. |
| **Target** | Promote to both hosts P2 (automations currently no send_media — unify). |

### 2.5 Send Template (Approved)

| Field | Contract |
|-------|----------|
| Visual | Picker: approved template name + language + variable slots `{{1}}` mapped from `vars`/`message.text`. |
| Schema | Automation-only `SendTemplateStepConfig { template_name, language?, variables?: Record<string,string>, channel_target? }` (`types/index.ts:548`). |
| Required | `template_name`. |
| Optional | `language`, `variables` (sorted numeric `1..N`). |
| Channel | **WhatsApp only** — locked `whatsapp` at builder (`FlowEditorProvider` channel_target row locked WA). TG has no approval; attempting template with TG target → validation error `Templates are only supported for WhatsApp` (`automations/engine.ts:461`). |
| Runtime | `engineSendTemplate` (`automations/engine.ts:483`) with numeric-sorted params; failure non-recoverable mid-run. |
| Validation | `validateStepsForActivation:93` template_name required. Builder locks channel. |
| Gap | Flows have no template node — intentional (conversational flows use plain text; broadcasts/templates live in Automations). Keep. |

### 2.6 Delay inside Message (Typing pause)

| Field | Contract |
|-------|----------|
| Visual | Small pill inside message node `Delay: Xs + typing indicator toggle`. |
| Schema | Content block `Delay { durationMs?, showTyping?: boolean }` inside message node (not standalone). Currently no dedicated Flow node type; ManyChat: Delay content block per channel. |
| Channel | Instagram, Messenger, TikTok, Telegram, WhatsApp per `channel-behavior.md` table. |
| Runtime | Pauses rendering, shows `typing…` where channel supports; does not suspend graph. |
| Target | P2: add as optional content block inside send_message for fidelity (not a graph wait). |

---

## 3. INPUT — Collect Input

| Field | Contract |
|-------|----------|
| Host | Flows only today (`unified-taxonomy.ts:99` hosts flow). |
| Visual | Ask card with prompt + `→ var_key` binding + next arrow. |
| Schema | Flow `CollectInputNodeConfig { prompt_text, var_key, validation?: any|email|phone|regex, regex?, next_node_key, channel_target? }` (`types.ts:124`). |
| Required | `prompt_text`, `var_key` (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`), `next`, `channel_target`. |
| Optional | `validation`, `regex` (accepted but runner ignores in v1.5 — builder surfaces for forward compat; docs note v2 will enforce). ManyChat's `Data Collection` has multiple choice / phone validation + 30-min timeout branch — ConvoxOS target P2 adds `timeout_branch` + type validation inside engine. |
| Inputs | 1 |
| Outputs | 1 (after capture). |
| Channel | All channels per Content Block table; TG uses text + inline? Actually collect prompts via text dispatch regardless of button presence. |
| Runtime | Sends `prompt_text` interpolated then suspends; next TEXT reply captured (`message.kind=text && currentNode=collect_input`) → `run.vars[var_key]=captured.trim()` + reset `reprompt_count` → `advanceFromNodeKey(next)` (`flows/engine.ts:798`). Non-text or empty → fallback path. |
| Failure | `collect_input_prompt_failed` → run `failed`. `var_key` missing → fallback. Channel missing → same as send nodes. |
| Validation | `validateFlowForActivation:589` prompt+var_key regex+next+channel. |
| Testing | Quick preview: input validation NOT enforced; image uploads unsupported; Multiple Choice / not-responded cannot be previewed (ManyChat VERIFIED). |
| Execution state | Suspending. Data collection 30-min timeout target (ManyChat verified) → where to store timeout? reuse pending execution pattern P1. |
| Serialization | Inside config; `{{vars.name}}` downstream interpolation uses captured var. |
| Analytics | Captured length logged (not value — PII not persisted in `node_entered {captured_key, captured_length}`). |
| Gap | Needs `timeout_next` branch + validation enforcement (email/phone/regex) P2 to match ManyChat. |

---

## 4. LOGIC

### 4.1 Condition

| Field | Contract |
|-------|----------|
| Flow schema | `ConditionNodeConfig { subject: var|tag|contact_field, subject_key, operator: equals|contains|present|absent, value?, true_next, false_next }` (`types.ts:158`). |
| Automation schema | `ConditionStepConfig { subject: tag_presence|contact_field|message_content|time_of_day, operand?, value? }` with nested branches `parent_step_id+branch yes/no` (`types/index.ts:595`). Tag divergence is intentional per-taxonomy but should converge: target unify to `subject: var|tag|contact_field|message_content|time_of_day`. |
| Visual | Diamond with condition summary → two labeled edges `Yes/No` (Automation) / `True/False` (Flows). Flows allow unlimited fan? No, always 2. |
| Required | `subject` + `subject_key/operand` + `operator`; `true_next/false_next` (flows) both wired for deterministic flow. Automations branch children at position 0 within yes/no. |
| Optional | `value` for equals/contains (empty allowed → warning). |
| Inputs | 1 |
| Outputs | 2 |
| CRM read | `var` → `flow_runs.vars[key]`; `tag` → `contact_tags` count; `contact_field` → `contacts[name|email|phone|company]`; automation adds `message_content` (substring) + `time_of_day` (HH:mm-HH:mm). No write. |
| Runtime | `evaluateConditionPredicate` pure then `evaluateConditionNode` DB lookup (`flows/engine.ts:607`), `evaluateCondition` (`automations/engine.ts:807`) with account scoping on `contact_field`. Always auto-advances; no suspend. Logs `node_entered {condition_result, advancing_to}`. |
| Failure | Unsupported `contact_field` → throw `unsupported contact_field` → run `condition_evaluation_failed` → `failed`. Tag lookup errors non-fatal? Flow treats as eval exception; automation returns false on missing contact/operand. |
| Validation | `validateFlowForActivation:653` subject+key+operator+both branches. `validateStepsForActivation:142` subject+operand. |
| Testing | Quick preview: conditions cannot be evaluated — you manually choose path (ManyChat VERIFIED). |
| Execution state | No wait; immediate branch. |
| Gap | Need unified `subject` enum + AND/OR multi-condition per block (ManyChat supports up to many conditions with `all/any`). Currently single predicate per node/step → P1: multi-condition group. |

### 4.2 Randomizer / Split — TARGET (not yet implemented)

| Field | Contract — target P2 |
|-------|----------------------|
| Visual | Split diamond with 2–6 % labeled outputs. |
| Schema | `RandomizerNodeConfig { variations: [{key,label,percent,next_node_key}] (2–6), mode: sticky|every_time, percent sum=100 }` Channel-neutral. |
| Required | 2–6 variations, percent sum 100, each next exists. |
| Optional | none. |
| Inputs | 1 |
| Outputs | 2–6 |
| Persistence | Unchecked (default sticky): per-contact assignment persisted (contact-level bucket keyed by node_key; first visit assigns bucket; on re-entry same path). Checked: random every visit, no stats. ManyChat VERIFIED distribution quirk for batch sends. |
| Runtime | Immediate random or sticky lookup, then branch. No wait. |
| Validation | ≥2 variations, sum 100. |
| Analytics | Distribution per variation + unique counts. |
| Host | Target both (ManyChat flow-only but GHL Split is workflow-wide — unify). |

### 4.3 Goal — TARGET (GHL, P2)

| Field | Contract — target P2 |
|-------|----------------------|
| Visual | Flag node `Goal: <event>` with single next after bypass. |
| Purpose | Contacts that hit defined event skip intermediate steps (GHL verified). |
| Schema | `GoalNodeConfig { event: tag_added|appointment_booked|opportunity_won|custom, jump_to_next_node_key }` Waits passively (listening) while preceding Wait/Delay steps are active; when event fires, pending steps are skipped. |
| Runtime | Needs global listener in `processNormalizedInbound` like `Goal` check before `advanceCurrentNodeKey`. Not present today. |
| Gap | Requires new table/column for goal wait state OR reuse pending execution with goal branch jump. |

---

## 5. TIMING — Wait / Smart Delay

### 5.1 Wait (standalone)

| Field | Contract |
|-------|----------|
| Flow schema | `WaitNodeConfig { amount: number, unit: minutes|hours|days, next_node_key }` (`types.ts:182`). Mirrors `WaitStepConfig` (`types/index.ts:584`). Allowed `wait` node_type via `046_allow_wait_node_type.sql` CHECK expansion. |
| Visual | Hourglass with `Wait 2 hours → Next`. |
| Required | `amount ≥1`, `unit ∈ {minutes,hours,days}`, `next`. |
| Inputs | 1 |
| Outputs | 1 |
| Channel | Neutral. |
| Runtime | `flows/engine.ts:915` waitMs → insert `automation_pending_executions {flow_run_id, account_id,user_id,contact_id, context:{next_node_key, vars, trigger_channel, conversation_id, flow_id}, run_at: now+ms, status:pending}` then `advanceCurrentNodeKey` to self + return `advanced` (suspend). Automation `engine.ts:297` same table `next_step_position = step.position+1`. Cron `resumePendingExecution` re-enters via `executeStepsFrom` / `advanceFromNodeKey` at `next_node_key`. |
| Failure | `wait_enqueue_failed` → run `failed`. Insert schema requires `status pending`; trigger_channel captured in context so `Current` on resume uses original snapshot not new inbound channel. |
| Validation | `validateFlowForActivation:770` amount+unit+next; `validateStepsForActivation:131` same. |
| Testing | Not executed in quick preview (ManyChat VERIFIED: Smart Delay not displayed/executed in In Manychat). Full test advances via cron simulation or manual `run_at` fast-forward in dry-run. |
| Execution state | Suspending — `active` + pending row. Stats `Waiting / Passed` visible. |
| Serialization | `config.amount/unit/next` + persisted pending `context.next_node_key`. |
| Future | ManyChat Smart Delay variants: `Duration` with `Continue between HH:mm–HH:mm + day filter` + `Date (Specific/Dynamic + offset)` using contact timezone then account fallback + admin pause addition + 24h window caveat (Telegram exempt). **Target P2:** expand Wait to those variants (currently fixed duration only). |

---

## 6. CRM — Tag / Contact / Deal / Assign / Handoff / Close

### 6.1 Tag (Add / Remove)

| Field | Contract |
|-------|----------|
| Flow | `SetTagNodeConfig { mode: add|remove, tag_id, next_node_key }` (`types.ts:175`). |
| Automation | `add_tag / remove_tag` with `TagStepConfig {tag_id}` (`types/index.ts:555`). `unifiedTag*` adapters in `unified-taxonomy.ts:124`. |
| Required | `mode`, `tag_id` (UUID of existing tag), `next` (flow) / next position (automation). |
| Inputs | 1 |
| Outputs | 1 |
| CRM write | `contact_tags` insert/delete. Flow uses `addContactTagAndDispatch` (also fires `tag_added` automations) / `removeContactTag`. Automations `addContactTagIfAbsent` then `runAutomationsForTrigger(tag_added, depth+1)` with `MAX_TAG_CHAIN_DEPTH` guard (`automations/engine.ts:495`). |
| Runtime | Auto-advance; non-fatal on failure — logs `set_tag_failed` warning and continues (`flows/engine.ts:904`); automations log tag already present. |
| Validation | `validateFlowForActivation:726` mode+tag_id+next; `validateStepsForActivation:98` tag_id. |
| Testing | Tag condition in quick preview is manual choice — so tag write not verified there. |

### 6.2 Update Contact Field

| Field | Contract |
|-------|----------|
| Host | Automations only (`unified-taxonomy.ts:103` update_contact). |
| Schema | `UpdateContactFieldStepConfig { field: string, value: string }` where field `name|email|company` (built-in) or `custom:<custom_field_id>` (`types/index.ts:564`). Supports `{{vars.*}}/{{message.text}}` interpolation. |
| Required | `field`, `value` (value can be empty string via interpolation but publish requires non-empty template). |
| CRM write | `contacts` column update scoped `eq(account_id, account_id)` + `contact_custom_values` upsert on `(contact_id, custom_field_id)` after `custom_fields` ownership guard (`automations/engine.ts:578`). |
| Validation | `validateStepsForActivation:112` field+value required. |
| Target | Promote to Flows P2 (same schema). |

### 6.3 Create Deal

| Field | Contract |
|-------|----------|
| Host | Automations only (`unified-taxonomy.ts:104`). |
| Schema | `CreateDealStepConfig { pipeline_id, stage_id, title, value? }` (`types/index.ts:577`) title interpolated. |
| CRM write | `deals {account_id,user_id,pipeline_id,stage_id,contact_id,title,value,currency,status=open}` with `default_currency` fallback (`automations/engine.ts:621`). |
| Validation | `validateStepsForActivation:120` pipeline+stage+title required. |
| Target | Need `Update Opportunity / Move Stage` companion P1 for GHL parity (currently create-only). |

### 6.4 Assign Conversation

| Field | Contract |
|-------|----------|
| Schema | `AssignConversationStepConfig { mode: specific|round_robin, agent_id? }` (`types/index.ts:559`). |
| Required | `mode`; `agent_id` when specific. |
| CRM write | `conversations.assigned_agent_id` scoped `account_id+contact_id` (`automations/engine.ts:561`). Round-robin picks one `profiles` row (placeholder until real RR). |
| Validation | `validateStepsForActivation:104` agent_id when specific. |

### 6.5 Handoff (Flow terminal)

| Field | Contract |
|-------|----------|
| Schema | `HandoffNodeConfig { note?, assign_to?: user_id }` (`types.ts:105`). |
| Visual | Hand icon terminating flow. |
| CRM write | `conversations {status=pending, assigned_agent_id?, updated_at}` (`flows/engine.ts:575`). Logs `handoff {note, assigned_to}` + `endRun(handed_off)`. |
| Execution state | Terminal `handed_off`. |
| Fallback also uses handoff on `on_exhaust: handoff` or `fallback_exhausted handoff` (`engine.ts:1296`). |

### 6.6 Close Conversation (Automation)

| Field | Contract |
|-------|----------|
| Schema | `close_conversation` (no config) (`types/index.ts:490`). |
| CRM write | `conversations.status=closed` (`automations/engine.ts:674`). |

### 6.7 Missing CRM nodes (target gaps)

- **Add Note** (contact note) — P1 (table `contact_notes` exists via `001_initial_schema.sql` but no workflow node).
- **Add Task** — P1 requires `tasks` entity new (see `crm-automation.md`).
- **Opportunity / Pipeline move** — P1.
- **Disable/Enable DND** — P3.

---

## 7. INTEGRATION — Webhook / External Request / Dynamic

| Field | Contract |
|-------|----------|
| Current | `send_webhook` with `SendWebhookStepConfig { url, headers?, body_template? }` (`types/index.ts:603`). Allowed `Flow http_fetch` in DB CHECK but not runtime. |
| Visual | Webhook icon with URL + method badge. |
| Required | `url` (http/https only, URL parse check). |
| Optional | `headers`, `body_template` interpolated (`{{vars}}/{{message.text}}`) else `JSON.stringify(context)`. |
| Runtime | `isDeliverableUrl` SSRF guard → `fetch(url, {method POST, headers:{content-type:application/json,...}, body, redirect:manual, signal:10s})`; non-ok throws `webhook returned N` → step `failed` (`automations/engine.ts:649`). |
| Validation | `validateStepsForActivation:150` URL required + protocol http/https + URL parse. Builder should validate SSRF hint before save (warning). `Dynamic` (ManyChat) variant P2 adds GET/PUT/DELETE method + response mapper + fallback branch. |
| Channel | Neutral. |
| Gap | Expand to full External Request (method selector) + Google Sheets action P3. |

---

## 8. CONTROL — End

| Field | Contract |
|-------|----------|
| Schema | `EndNodeConfig = {}` terminal (`types.ts:189`). |
| Visual | Flag. |
| Runtime | `logEvent(completed)` + `endRun(completed,end_node)` (`flows/engine.ts:988`). Automation without end simply finishes (no explicit end step required). |
| Gap | Automation `end` P2 alignment (currently flow-only). |

---

## 9. Connection Contract Summary (referenced per node above)

- **Sequential** `next_node_key` required except terminals.
- **Branch** `true_next/false_next` 2 edges; **Button** N edges; **List** flatten rows; **Randomizer** 2–6 edges (target).
- **Wait/Interactive** single next after resume.
- **Reusable** Start Automation single call edge + single continue after return (target P2 — not yet graph-level, today Flows have no Start Automation, Automations use trigger chaining indirectly).
- **Invalid dangling/unreachable/cycle/duplicate reply_id → error/warning** via `validateFlowForActivation` (140 edges reachability BFS `reachableFromEntry` + `outgoingEdges`). Automation branch walk via `builder-tree.ts:1` (`validate.ts:43`).

---

*Next: `channel-capabilities.md` (matrix + builder gating) + `crm-automation.md` (entity gaps + state surface).*
