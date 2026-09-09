# Phase 2 Architecture Verification — Unified Graph → Builder Foundation

> **Scope:** Audit only — no code changes, no refactors, no Phase 3.  
> **Against:** `MANYCHAT_PRO_FLOW_BUILDER_SPEC.md`, `MANYCHAT_CONVOX_ARCHITECTURE_PLAN.md`, `unified-automation-graph.md`, actual Phase-2 implementation (`src/lib/automation/*`, `src/components/flows/*`, `src/lib/flows/edges.ts`, `055` migration).  
> **Graphify used:** Re-queried for `Message content_blocks`, `BuilderState`, `graph-service`, `flow-editor-state`, `edges` — inspected relevant paths only.

---

## A. PASS — Architecture Ready for Phase 3 (with 3 non-blocking WARNINGs)

**Verdict:** **PASS.** Phase-1 canonical types + Phase-2 builder shell are sufficient to carry Phase-3 deep editors (Message 12 blocks, Action tasks, Smart Delay windows, Start Automation sync, AI Step) **without another structural rewrite**. Two prior BLOCKERs from Phase-1 audit remain fixed; zero new BLOCKERs found.

---

## B. Blockers Before Phase 3

**None.** No blocker that would force a foundational rewrite.

---

## C. Non-Blocking Issues (defer, track for Phase 3/4)

| # | Severity | Area | Finding | Impact if deferred | Recommendation |
|---|----------|------|---------|-------------------|---------------|
| 1 | **WARNING** | BuilderState trigger | `BuilderState.trigger_type: "keyword"\|"first_inbound_message"\|"manual"` still narrow union; unified `trigger_envelope` carries 15+ Manychat kinds (`tag_added`, `instagram_comments`, etc.) but legacy column stays narrow. Creating a `tag_added` via envelope would set `trigger_type=tag_added` which violates legacy `FlowRow["trigger_type"]` type until `FlowRow` is widened to `UnifiedTriggerKind`. | Phase-3 trigger editors for CRM/Manychat kinds will need `FlowRow` and `BuilderState` widening + validation expansion. | Expand `FlowRow.trigger_type` and `BuilderState.trigger_type` to `UnifiedTriggerKind` (or make `string`) before Phase-3 trigger UI lands. |
| 2 | **WARNING** | Flow/Basic sharing | `flow-editor-shell.tsx` canvas/list **do** share `BuilderState` (true unified view). Legacy `src/components/automations/automation-builder.tsx` + `basic-view.tsx` (automations sequential tree) still exists as separate system and is **not** yet unified to `flows` graph. Spec `Unified Automation → Flow Builder / Basic View` is half-landed: flows side unified, automations side not. | Phase-3 message/action deep editors will land twice if automations builder not retired. | Retire `automation-builder` to read via `graph-service` alias in Phase-3 cutover (plan §6 already documents `/api/automations` → graph-service). |
| 3 | **WARNING** | Validation depth | Phase-2 validation is `validateFlowForActivation` (name/trigger/entry/dangling/reachable/cycle). Manychat Meta limits (button ≤20, WA 3 vs TG 10, list ≤10, sum 100, window left<right) still live in legacy `validateFlowForActivation` / `src/lib/automation/validate.ts` split, not yet unified under `graph-service.validateGraphForActivation` (which currently checks only envelope presence + dangling). | Phase-3 editors could allow invalid Manychat payloads until unified validator is wired to `flow-editor-state`. | Wire Phase-2.5: replace `flow-editor-state` validator import with `graph-service` unified validator + Manychat limits, keep `ValidationIssue {severity error|warning}` single source. |

No other warnings block Phase-3 structural work.

---

## D. Detailed Checks (13 Required)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | **Message as `content_blocks[]`** | **PASS** | `graph-types.ts:129 ContentBlock` 12-kind union (`text|image|delay|data_collection|file|audio|video|pdf|card|gallery|messenger_list|dynamic`) + `MessageContainerConfig {channel_target?, content_blocks: ContentBlock[], next_node_key?}`. Scaffold ready even though Phase-2 editor only creates `[{kind:"text"}]` one-liner — no rewrite needed to add remaining blocks. |
| 2 | **Action as `tasks[]`** | **PASS** | `graph-types.ts:186 ActionTask` 12-kind (`add_tag`…`integration`) + `ActionNodeConfig {tasks: ActionTask[], next_node_key}`. Phase-2 default `tasks:[]` placeholder; Phase-3 will populate task editors — container shape already canonical. |
| 3 | **Heterogeneous edges** | **PASS** | `src/lib/automation/edges.ts:30 deriveEdges()` switches on `UnifiedNodeType` with distinct kinds (`next|true_next|false_next|button|list_row|variant|fallback|reply`). `edges.ts` (legacy) patched to handle `message|action|smart_delay|start_automation|ai_step` as `next`, so both edge layers agree. |
| 4 | **Message button/choice outputs** | **PASS** | `edges.ts:38` derives `text.buttons[] → button`, `card/gallery.buttons → button`, `data_collection.choices[] → reply` + `notResponded_next`, `dynamic.fallback_next`, `next_node_key` fallback when no branching. Future Quick Reply block inside Message will be new `ContentBlock` kind with same branch loop — additive. |
| 5 | **Node config registry** | **PASS** | `flow-canvas.tsx:610 NodeEditSheet` mounts `NodeConfigForm` dynamic dispatcher (`forms/node-config-form.tsx`) — registry pattern, not giant conditional in canvas. Per-type editors will be added under `NodeConfigRegistry {MessageConfig, ActionConfig,…}` per Phase-3 without touching shell. |
| 6 | **Canonical BuilderState → graph-service → DB** | **PASS** | `flow-editor-state.tsx:65 BuilderState {name,description,trigger_type,trigger_config,trigger_envelope?,entry_node_id,status,nodes: BuilderNode[]}` + `graph-service.ts:42 normalizeEnvelope / :152 createGraph / :189 updateGraph` operating on `flows {trigger_envelope, entry_node_id} + flow_nodes {node_key, node_type, config}`. `src/app/api/flows/route.ts:42` now accepts `trigger_envelope` OR legacy and persists both. |
| 7 | **Flow / Basic share same graph** | **PASS (flows), WARNING (automations)** | `flow-editor-shell.tsx:96` `effectiveView` canvas/list toggle both mount inside `FlowEditorProvider` → same `BuilderState` via `useFlowEditor()`, history preserved. Automations builder (`automation-builder.tsx`) still separate sequential system — documented as Phase-3 cutover, not Phase-2 blocker. |
| 8 | **Validation centralized** | **PASS** | `flow-editor-state.tsx:371` `validateFlowForActivation` deferred via `useDeferredValue` (single source) → `ValidationPanel` renders `issues {severity,scope,node_key,field}`. No duplicate logic in React. Phase-2.5 will swap to unified `graph-service` validator. |
| 9 | **Undo/redo graph-state based** | **PASS** | `flow-editor-state.tsx:314 historyRef/futureRef/isUndoRedoRef + historyVersion`, `setState` pushes `JSON.parse(JSON.stringify(prev))` clone, `undo/redo` swaps `BuilderState` snapshot (not DOM), `duplicateNode` clones config with offset. Header `Undo2/Redo2` + `Ctrl+Z / Ctrl+Shift+Z` listener. |
| 10 | **Channel-specific validation future** | **PASS (scaffold)** | `ChannelTarget = current|whatsapp|telegram` in `graph-types.ts:22`, `shared.tsx` `authoringChannel` ephemeral hint, `flow-editor-state:529 channel_target: current` default for conversational triggers. `ContentBlock` allowlist matrix `docs/specs/channel-capabilities.md` not yet enforced — but `MessageContainerConfig.channel_target` + `edges` branching leave room to add `validateChannelAllowlist()` in Phase-3 without model change. |
| 11 | **Runtime decoupled from canvas** | **PASS** | Canvas `FlowNodeCard` + `FlowCanvasInner` only handle visual `deriveCanvasEdges/outgoingSlots/applyEdgeConnection/unlinkNodeReferences`; no `src/lib/flows/engine.ts` `advanceFromNodeKey` logic in canvas. Runtime stays in `lib/flows/engine.ts:733` / future `lib/automation/engine.ts` — canvas will call `graph-service` save, not execute. |
| 12 | **Start Automation / nested sync** | **PASS** | `graph-types.ts:250 StartAutomationNodeConfig {callee_flow_id, next_node_key}`, `edges.ts:86` `start_automation` single `next` continuation, `NODE_META start_automation` in `shared.tsx`, `defaultConfigFor start_automation`. Spec sync-flush (`callee messages without button wait`) will be runtime in `graph-service`/`engine` Phase-4 — no canvas rewrite needed. |
| 13 | **AI Step without rewrite** | **PASS** | `graph-types.ts:255 AiStepNodeConfig {goal,context≤10k,channel?,tasks: {label,saveToField}[], next_node_key}`, `UnifiedNodeType ai_step`, `shared.tsx` `ai_step` meta + `defaultConfigFor ai_step`, `edges.ts` `ai_step` single next. Gated behind Pro+AI flag per spec — additive. |

**No Manychat-model conflicts introduced:** Legacy `send_*` aliases kept as non-canonical compat (not promoted), new canonical `message|action` do not re-encode old `position` sequential assumption, `trigger_envelope` OR not modeled as multiple automation copies, `preview_sessions`/`contact_randomizer_buckets` are additive.

---

## Recommendation for Next Phase

**Proceed to Phase 3** (Message multi-block + Action multi-task deep editors) on top of current foundation.

Before Phase-3 editors land, fix the 3 WARNINGs in this order:

1. Widen `FlowRow.trigger_type / BuilderState.trigger_type` to `UnifiedTriggerKind` (or `string`) and make `flow-editor-state` validation read `trigger_envelope` when present.
2. Unify validation import to `graph-service.validateGraphForActivation` (with Manychat limits) so canvas and list share one `error|warning` source.
3. Plan automations builder retirement (`/api/automations` → `graph-service` alias) to avoid double editors.

No foundational rewrite required — Phase-2 scaffolding carries Phase-3 payload.
