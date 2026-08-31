# ConvoxOS Repository Audit — vs Target Contracts (2026-08-31)

> HEAD: `752583e` (main). Graphify stale at `3f94faf7` — targeted reads below. No code changes in this phase; observations only. Migration range `001`–`046`.

## Method

- Target contracts: `docs/specs/automation-product-spec.md`, `builder-spec.md`, `node-system.md`, `channel-capabilities.md`, `crm-automation.md`.
- For each capability: `file_path:line_number` + Graphify community where useful.

---

## 1. Flows Engine

| Capability | Current Support | Missing Support | Prereq | Priority | Evidence |
|------------|-----------------|-----------------|--------|----------|----------|
| **Graph model** | `flow_nodes.node_key` stable string, edges inside `config` JSONB, `(flow_id, node_key) UNIQUE` `supabase/migrations/010_flows.sql:137` | — | — | — | `src/lib/flows/types.ts:30` configs, `src/lib/flows/edges.ts:40` deriveCanvasEdges |
| **Node types** | 10: start, send_message/buttons/list/media, collect_input, condition, set_tag, wait, handoff, end `src/lib/flows/types.ts:201` + DB CHECK includes `http_fetch` `010_flows.sql:128` but runtime not handled | http_fetch runtime missing; no randomizer/goal | — | P2 | `src/lib/flows/types.ts:182`, `010_flows.sql:118` |
| **Channel target** | Per send node `channel_target current|whatsapp|telegram` nullable, legacy null→whatsapp, current→snapshot `src/lib/flows/engine.ts:175` resolveChannelTarget | Validation uses WA cap even for TG (P0) | channel-aware validation | P0 | `src/lib/flows/types.ts:199`, `src/lib/flows/validate.ts:248`, `engine.ts:718` dispatch |
| **Trigger channel snapshot** | `flow_runs.trigger_channel whatsapp|telegram|null` `043_flow_run_trigger_channel.sql:1` captured at `startNewRun` `src/lib/flows/engine.ts:714` + passed via `processNormalizedInbound.ts:351` | — | — | — | `src/lib/flows/types.ts:275` row |
| **Channel-aware resume** | `loadActiveRunsForContact` all active (no LIMIT 1) → filter `trigger_channel+replyId` match `src/lib/flows/engine.ts:1073` isolation | ManyChat's intent/word-boundary keywords not yet | — | P1 | `src/lib/flows/resume-channel.test.ts:1` 4 isolation tests |
| **Per-flow uniqueness** | `UNIQUE(account,contact,flow_id) WHERE active` `044_flow_run_per_flow_uniqueness.sql:1` allows TG Flow A + WA Flow B both waiting | — | — | — | `src/lib/flows/engine.ts:342` startNewRun 23505 collide |
| **Wait suspension** | `wait` node inserts `automation_pending_executions {flow_run_id, run_at, context:{next_node_key,vars,trigger_channel}}` `src/lib/flows/engine.ts:915` + reuse same table via `045_flow_wait.sql:6` | Smart Delay variants (timed window, specific/dynamic date, contact timezone) not yet; no business-hours | current wait table sufficient | P1 | `supabase/migrations/045_flow_wait.sql:1` |
| **Condition** | Single predicate var|tag|contact_field with equals/contains/present/absent + true/false branches `src/lib/flows/types.ts:158` evaluated via DB lookup `src/lib/flows/engine.ts:607` | Multi-condition AND/OR per block (ManyChat) missing | schema JSONB extensible | P1 | `src/lib/flows/validate.ts:653` |
| **Collect input** | Prompt→suspend at `collect_input`, capture to `vars[var_key]` via text reply, PII captured_length only `src/lib/flows/engine.ts:798,1207` | Timeout branch (30m), validation (email/phone/regex) ignored in runner (accepted but no-op) | — | P2 | `src/lib/flows/types.ts:124` validation ignored note |
| **Fallback / reprompt** | `fallback_policy {on_unknown_reply:reprompt|handoff|ignore, max_reprompts, on_timeout_hours, on_exhaust}` `src/lib/flows/types.ts:307` + `src/lib/flows/fallback.ts:1` decideFallback | on_timeout sweep cron not wired (status timed_out exists but no sweeper) | cron route | P1 | `src/lib/flows/engine.ts:1239` fallback path, `src/app/api/flows/cron/route.ts:1` |
| **Validation** | `validateFlowForActivation` checks name, trigger, entry, duplicate key, per-node meta limits, unreachable BFS `src/lib/flows/validate.ts:57,808` | Channel-aware cap (TG 10 vs WA 3) not branched; cycle detection missing; http_fetch no validation | add per-target cap + DFS cycle | P0/P1 | `src/lib/flows/validate.ts:362` maxButtons check |
| **Edges** | `deriveCanvasEdges` + `outgoingSlots` + `applyEdgeConnection` + `unlinkNodeReferences` pure `src/lib/flows/edges.ts:1` handles button/row/condition true/false | — | — | — | community flows/edges |
| **Exec state** | `flow_runs.status active|completed|handed_off|timed_out|paused_by_agent|failed` `010_flows.sql:165` + `flow_run_events` 9 types `010_flows.sql:219` idempotent via meta_message_id `src/lib/flows/engine.ts:351` | Version history, Stats View per trigger | — | P2 | `src/lib/flows/types.ts:276` row |

## 2. Automations Engine

| Capability | Current | Missing | Prereq | Priority | Evidence |
|------------|---------|---------|--------|----------|----------|
| **Trigger catalog** | 8: new_message_received, first_inbound_message, keyword_match, new_contact_created, conversation_assigned, tag_added, time_based, interactive_reply `src/types/index.ts:465` | 70+ HighLevel triggers: contact_changed/dnd, note/task added, appointment_*, opportunity_*, inbound_webhook, scheduler, form, call, etc. | entity tables + context shapes | P1 | `src/lib/automations/trigger-meta.ts:1`, `src/lib/automations/engine.ts:759` triggerMatches |
| **Trigger channel filter** | `trigger_config.channel any|whatsapp|telegram` on keyword_match/interactive_reply with fails-closed when context has no channel `src/lib/automations/engine.ts:759` | Consistent behavior for all conversational triggers (customer_replied not yet) | — | P0 keep | `src/lib/automations/channel.test.ts:27` |
| **Channel target on sends** | `send_message/buttons/list/template` carry `channel_target current|whatsapp|telegram` `src/types/index.ts:533` resolved via `resolveAutomationChannelTarget` legacy null→whatsapp `src/lib/automations/engine.ts:63` | Service tests use deprecated `normalizeChannel('telegram'→'whatsapp')` still? Not here — logic correct | channel-aware validate | P0 | `src/lib/automations/engine.ts:391,406,456` |
| **Send nodes** | 12 step types: send_message/buttons/list/template, add/remove_tag, assign_conversation, update_contact_field, create_deal, wait, condition, send_webhook, close_conversation `src/types/index.ts:477` + `unified-taxonomy.ts:56` | send_media, randomizer/goal, add_note/task, update_opportunity/move_stage, disable dnd, copy contact, card/gallery | entity + taxonomy extensible | P1-P2 | `src/lib/automations/validate.ts:59` cases |
| **Condition** | `subject tag_presence|contact_field|message_content|time_of_day` `src/types/index.ts:589` evaluated `src/lib/automations/engine.ts:807` | Unified with flow subjects + AND/OR multi | same | P1 | `src/lib/automations/validate.ts:142` |
| **Wait** | `wait {amount,unit minutes|hours|days}` enqueues `automation_pending_executions {next_step_position, context.vars+trigger_channel, run_at}` `src/lib/automations/engine.ts:297` + `006_automations.sql:119` partial index `run_at` | Timed window, specific/dynamic date, business hours not yet | same table | P1 | `src/lib/automations/engine.ts:860` waitMs |
| **Webhook** | `send_webhook {url,headers,body_template}` with `isDeliverableUrl` SSRF + 10s timeout + manual redirect + trigger-dependent payload warning not yet `src/lib/automations/engine.ts:649` | Method selector GET/PUT/DELETE + Google Sheets | — | P2 | `src/lib/webhooks/ssrf.ts:1` |
| **CRM writes** | tags via `addContactTagIfAbsent`+tag chain depth guard `006_automations.sql` depth `src/lib/automations/engine.ts:495`; contact custom via `custom:<id>` guard `engine.ts:578`; deal create with default_currency `engine.ts:621`; assign round-robin placeholder `engine.ts:548` | Add Note/Task, Update Opportunity/move, DND | tasks table etc. | P1 | `src/types/index.ts:555` |
| **Logs** | `automation_logs {status failed pessimistic default, steps_executed JSONB}` `src/lib/automations/engine.ts:192` merged via `appendResults` | Per-trigger Attempted/Matched/Unmatched stats | — | P2 | `src/lib/automations/engine.ts:873` |
| **Validation** | `validateStepsForActivation` 12 cases + channel_target required for comms `src/lib/automations/validate.ts:30` using `validateInteractivePayload(c)` WA caps | Channel-aware cap missing | same | P0 | `src/lib/automations/validate.ts:76` |
| **Dry run** | `src/lib/automations/dry-run.ts:1` used by test-dialog `src/components/automations/test-dialog.tsx:1` | Flows dry-run not yet (automations only) | — | P2 | `src/lib/automations/dry-run.ts:11` |
| **Builder** | `automation-builder.tsx:21` tree `builder-tree.ts:1` parent_scope branches yes/no + `steps-tree.ts` | Minimap/switcher/version history/shortcuts not yet | xyflow reuse | P2 | graphify community 4 |

## 3. Channel Layer

| Capability | Current | Missing | Prereq | Priority | Evidence |
|------------|---------|---------|--------|----------|----------|
| **Channel enum** | `Channel = whatsapp|telegram` `src/lib/channels/types.ts:11` + `messages.channel CHECK` `041/042` | instagram/messenger/sms extension requires CHECK migration | — | P4 | `src/lib/inbound/processNormalizedInbound.ts:233` |
| **NormalizedInbound** | `providerMessageId, kind text|interactive_reply|media|location|reaction, channel, accountId, configOwnerUserId, telegram* , senderPhone/Name` `src/lib/channels/types.ts:15` | Email/sms kind | — | P4 | `src/lib/channels/types.ts:15` |
| **Inbound routing** | WA webhook `src/app/api/whatsapp/webhook/route.ts:1` + TG webhook `src/app/api/telegram/webhook/[configId]/route.ts:1` both normalize → `processNormalizedInbound.ts:232` unified contact+conversation+message+bump+reopen+broadcastFlag+flows+automations+AI+webhook | IG/Messenger verify/auth not yet | — | P4 | `src/lib/inbound/processNormalizedInbound.ts:105` findOrCreateContactUnified |
| **Contact identity** | `contacts.phone nullable` `041` + `telegram_user_id BIGINT UNIQUE(account,telegram_user_id) WHERE NOT NULL` `041` + normalized phone `022` | instagram_user_id/messenger etc. | — | P4 | `supabase/migrations/040_telegram_config.sql:1` |
| **Message provenance** | `messages.channel NOT NULL DEFAULT whatsapp` `042` idx `idx_messages_channel` | — | — | — | `041_channel_provenance_nullable.sql:1` |
| **Outbound WA** | `sendMessageToConversation` `src/lib/whatsapp/send-message.ts:1` meta-api + `meta-send.ts` for flows/automations, 24h window `src/lib/whatsapp/session.ts:1` | — | — | — | graphify community meta-api |
| **Outbound TG** | `sendTelegramText` `src/lib/channels/telegram/send.ts:1` + `sendTelegramMedia` `send-media.ts:1` + `keyboard.ts:1` validate + `api.ts:1` getMe/setWebhook | TG templates none (ok) | — | — | `src/lib/channels/telegram/send.ts:144` reply_markup |
| **Socket thin** | `dispatchText:65, dispatchMedia:110, dispatchInteractive:177, resolveChannelTarget:222` `src/lib/channels/socket.ts:1` explicit branches, normalized ChannelSocketError | — | — | — | `src/lib/channels/socket.ts:18` class |
| **Inbox channel UX** | `availableChannels from phone/telegram_user_id`, `selectedChannel` local/thread, `Reply via` selector when both, Telegram not connected banner `src/components/inbox/message-thread.tsx:86` + composer `src/components/inbox/message-composer.tsx:50` | Single composite message with mixed channel not needed | — | — | `src/lib/inbox/conversations.ts:52` CHANNEL_ORDER |

## 4. CRM Entities

| Entity | Current | Missing | Prereq | Priority | Evidence |
|--------|---------|---------|--------|----------|----------|
| **Contacts** | `contacts` with dedupe `022` + RLS `017` `phone_normalized`, `telegram_*` | DND flag | same table | P3 | `src/types/index.ts:99` |
| **Custom fields** | `custom_fields`+`contact_custom_values` `001` | — | — | — | `src/types/index.ts:136` |
| **Conversations** | `conversations UNIQUE(account,contact)` `036` + status open/pending/closed | No separate `Sequence/Broadcast` state folded | same | — | `supabase/migrations/036_conversation_contact_dedup.sql:1` |
| **Pipelines/Deals** | `pipelines, pipeline_stages, deals` `001` with currency `021`, kanban `src/components/pipelines/*` | Update Opportunity/move stage nodes/triggers missing | same | P1 | `src/types/index.ts:358,376` |
| **Notes** | `contact_notes` `001` + account_id `017` | No automation node `add_note` | add node type | P1 | `src/types/index.ts:154`? actually ContactNote |
| **Tasks** | ❌ no `tasks` table | Needs new table + node + triggers Task Added/Reminder/Completed | new migration | P1 | NOT FOUND `grep tasks` returned empty |
| **Appointments** | ❌ no appointment table | Calendar integration P3 | — | P3 | NOT FOUND |
| **Messages / reactions** | `messages` `001`+`035` interactive + `037` wamid + `039` mirror ; `message_reactions` | — | — | — | `010` adds interactive widening |
| **Tags** | `tags`+`contact_tags` + chain depth `src/lib/contacts/tag-chain.ts:1` MAX_TAG_CHAIN_DEPTH | — | — | — | `src/lib/contacts/tag-events.ts:1` |
| **AI/Knowledge** | `ai_configs` `029` `ai_knowledge_documents/chunks` `030` + `dispatchInboundToAiReply` ordering `processNormalizedInbound:379` | Workflow AI action P3 | same | P3 | `src/lib/ai/*` |

## 5. Builder / Serialization / Persistence

| Aspect | Current | Gap | Evidence |
|--------|---------|-----|----------|
| **Flows persist** | `flows` envelope + `flow_nodes` JSONB + `position_x/y` | channel-aware limit, cycle guard | `src/app/api/flows/route.ts:1`, `src/app/api/flows/[id]/route.ts:1` |
| **Automations persist** | `automations` + `automation_steps position+parent_step_id+branch` | — | `supabase/migrations/006_automations.sql:53` |
| **Templates** | 3 flow templates `src/lib/flows/templates.ts:70` + automations templates `src/lib/automations/templates.ts:1` | ManyChat clone-on-broadcast not yet | `src/app/api/flows/templates/route.ts:1` |
| **Save/load/publish** | `PUT /api/flows/[id]` writes nodes + `validateFlowForActivation` before `status=active` `src/app/api/flows/[id]/activate/route.ts:1`; automations `route.ts` similar | Draft vs Published separate flag P2 (now single is_active/status) | `src/components/flows/flow-builder.tsx:1` |
| **Versioning** | None — undo stack per session only via `useTheme`? Actually header undo/redo buttons exist per `manychat model` spec but version history not persisted | HighLevel Version History P2 | NOT FOUND |
| **Testing** | Flows: no dry-run; Automations: dry-run `src/lib/automations/dry-run.ts:1` + test-dialog + `POST /api/automations/engine` manual trigger `src/app/api/automations/engine/route.ts:1`; Flows engine test via webhook dispatch | Flows full test with contact selector P2 | `src/components/automations/test-dialog.tsx:1` |
| **Stats** | No per-trigger Attempted/Matched/Unmatched; smart delay stats not surfaced | Stats View 30-day window P2 | NOT FOUND |
| **i18n/design** | Next.js16, Tailwind4, shadcn, next-intl `messages/` | — | `package.json:45` |

## 6. Known Bug Trace — send_buttons Telegram payload (read-only)

Builder stores `send_buttons` as canonical `InteractiveMessagePayload {kind:buttons, body, buttons:[{id,title}]}` via `validateInteractivePayload` caps `INTERACTIVE_LIMITS.maxButtons=3` `src/lib/whatsapp/interactive.ts:136`. Automation validate `src/lib/automations/validate.ts:79` calls `validateInteractivePayload(c)` on whole step_config — applies WA cap to TG builds.

Flow `sendButtonsAndSuspend` `src/lib/flows/engine.ts:439` correctly branches `if channel===telegram` mapping to `inline_keyboard: buttons.map(b=>[{text:b.title, callback_data:b.reply_id}])` + `dispatchChannelText` with markup.

Automation `runStep send_buttons` `src/lib/automations/engine.ts:417` similarly maps WA shape→TG `inlineKeyboard {inline_keyboard: payload.buttons.map(b=>[{text:b.title, callback_data:b.id}])}` and calls `dispatchChannelText` with keyboard. Then `dispatchInteractive` `src/lib/channels/socket.ts:177` for WA vs TG also correct.

`ChannelSocket.dispatchInteractive:177` reuses `dispatchText` with keyboard for TG — routing correct. Telegram `sendTelegramText:44` `validateTelegramInlineMarkup` accepts up to 8×8/64, callback 1–64B `src/lib/channels/telegram/keyboard.ts:44`.

**Conclusion:** ChannelSocket routing is correct; builder payload contract + validation is wrong — WA shape stored untransformed + WA cap blocks TG valid builds (≤10) while TG needs `inline_keyboard` shape with callback_data. No code fix in this phase; P0 is to make validation channel-aware (branch on `channel_target`) and store per-target limit.

---

*Evidence lines are from HEAD `752583e`; citations are exact files. Gaps marked P0–P4 per `P0=correctness/foundational ... P4=later`.*
