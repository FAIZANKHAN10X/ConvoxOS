# Builder Spec — ConvoxOS Automation Builder (2026-08-31)

> Synthesized from `docs/research/builder-ux-model.md` + `docs/specs/automation-product-spec.md`.
> Reference: `src/lib/flows/types.ts`, `src/lib/flows/validate.ts`, `src/components/flows/*`, `src/components/automations/*`, `src/app/(dashboard)/flows/*`, `src/app/(dashboard)/automations/*`.

## 1. Two Builders, One Canonical Model

- **Flow Builder** (visual canvas, `@xyflow/react`, node-key graph) and **Basic Builder** (`automations` builder-tree with sequential + nested branches) persist to same canonical definition per engine (Flow vs Automation stays separate per §5). The builder UX is one *product surface* with two renderers — toggle `Flow Builder ↔ Basic Builder` in header (ManyChat verified pattern).

- **Flows** graph: `flows` envelope + `flow_nodes` (node_key stable string, edges in config JSONB, positions_xy). **Automations** graph: `automations` envelope + `automation_steps` (position + parent_step_id/branch for nesting). Adapters exist (`builder-tree.ts:1`, `unified-taxonomy.ts:1`) — keep them, don't merge tables.

- **Templates:** `src/lib/flows/templates.ts:1` (`welcome_menu`, `faq_bot`, `lead_capture`) and `src/lib/automations/templates.ts:1` clone via `POST /api/flows {template_slug}` / equivalent. Correct model — portable, no DB gallery.

## 2. Canvas Contract

### 2.1 Layout

- **Infinite area** with pan (drag background) + zoom (wheel + buttons + `Fit to Screen`) + minimap bottom-right (add to Automations builder). Grid visible.
- **Header:** Rename input, Undo/Redo (header buttons + `Cmd+Z / Cmd+Shift+Z`), Preview (dropdown In-Canvas vs In-App), `Set Live / Publish` (toggle), ⋮ menu (duplicate flow, archive, copy link). Dirty state red dot next to Save.
- **Right sidebar / sheet:** Instrument bar (+). Trigger panel (Starting Step). Node config panel when selected.
- **Footer:** Zoom/pan help + AI assistant entry (future placeholder, not implemented P1).

### 2.2 Node creation / placement / movement

- **Add node:** `+` button in header → instrument bar with `UNIFIED_CATEGORIES` filtered by current `authoringChannel`; or double-click empty canvas → picker; or `+` on line (Automations) inserts after.
- **Place:** Drop at cursor; position stored in `flow_nodes.position_x/y` (or Automations `position`).
- **Move:** 6-dot drag handle on node card; `Move here` indicator on drop; multi-select via `Shift+click` or `Shift+drag` frame; keyboard `Arrow` nudges 8px; snapping to grid (8px). Changes dirty state.
- **Auto-arrange:** Button dagre layout via `src/lib/flows/layout.ts:1` (already present — keep).

### 2.3 Connections (see `docs/specs/node-system.md` + `src/lib/flows/edges.ts:1`)

- **Sequential (`next_node_key`):** Dot on node bottom → drag line to target node. Changing entry: drag dark dot from Starting Step to new first node (`Tips 9`).
- **Button/List branches:** Each button row / list row carries its own `next_node_key`; connecting creates edge; missing branch → publish warning/error.
- **Condition (`true_next` / `false_next`):** Two outputs, both must be wired for deterministic flow (warning if missing continuation).
- **Randomizer/Split (P2):** 2–6 outputs with % labels; slider to adjust.
- **Wait/Smart Delay:** Single next.
- **Start Automation / Add to Workflow (P2):** Single reference edge to callee; then single continue edge after callee.
- **Dangling:** Edge targeting non-existent `node_key` → publish error (already in `validateFlowForActivation`). Builder shows red dangling wire.
- **Unreachable:** Any node not BFS-reachable from entry → warning (already `validateFlowForActivation:130`).
- **Cycle:** DFS cycle detection at publish → error `Cycle detected without exit`; sequential-only loops blocked visually (arrow cannot return). Non-visible loops flagged at publish.
- **Rewire:** Drag existing edge's head to new target → rewires.
- **Delete node with edges:** Requires reconnect prompt or becomes dangling error; do NOT silently reconnect.

### 2.4 Selection / Editing / Menus

- **Select:** Click card → side sheet opens with node config form (`src/components/flows/forms/node-config-form.tsx:1` patterns). Single select only (multi-select for move/delete/duplicate only).
- **Config form:** Fields per node spec (`docs/specs/node-system.md`). Live validation (client `validateFlowForActivation` mirrors server). Channel row (`ChannelTargetRow`) filtered per channel.
- **Menus on node hover:** Duplicate (□) → clones node + renames `node_key` + rewires inbound to duplicate optionally; Delete (🗑) → confirms if node has inbound/outbound. No right-click menu P1.
- **Cross-node editing:** Editing trigger channel (`TriggerPanel` Any|WhatsApp|Telegram) revalidates all `current`-targeted nodes.

### 2.5 Copy / Paste / Duplicate

- **Alt+drag** clone (ManyChat verified). **Cmd/Ctrl+C/V** copies selected nodes with sanitized `node_key`s (suffix `-copy`) and rewrites internal edges within selection; external edges dropped (become dangling → warning).
- **Cross-automation paste:** Allowed if tag/field deps exist; otherwise action disabled / flagged with missing dep (same as ManyChat "some actions may be disabled if target account doesn't have Tags, Sequences").
- **Between accounts:** Not in ConvoxOS scope (single tenancy per account).

### 2.6 Undo / Redo / Save states

- **Undo stack 50** via `Cmd+Z` / header button; redo `Cmd+Shift+Z`. Each add/move/edit/delete/rewire is one entry.
- **Dirty:** Explicit boolean; header shows red dot; `Save` enabled when dirty + noBlockingError is false? Draft saves allowed with warnings (same as current: drafts incomplete allowed; activation blocks).
- **Save:** `PUT /api/flows/[id]` / `PUT /api/automations/[id]` writes `flow_nodes` / `automation_steps` rows + `flows.trigger_config` / `automations.trigger_config`. Snapshot version on save (History).
- **Saved ≠ Published:** Separate `is_active` / `status` toggle (publish). Saving does not publish; publishing saves first then toggles active if validation passes. Waiting contacts remain at current step (verified GHL behavior).

### 2.7 Validation states (visual)

| Severity | Visual | Blocks save? | Blocks publish? |
|----------|--------|--------------|-----------------|
| `error` (blocking) | Red dot on node + red border + tooltip with `ValidationIssue.message` | No | Yes |
| `warning` (non-blocking) | Yellow dash on node + warning list | No | No |
| `info` | Blue hint | No | No |

Issues live update: client validates on every edit (debounced) and server re-validates on PUT/POST (same logic prevents bypass via API). Fields link to `ValidationIssue.field` / `node_key` for jump-to-node.

### 2.8 Preview / Testing (inside builder)

- **Quick preview (In-Canvas, ManyChat-style):** Smartphone widget inside builder shows Text/Buttons/Quick Replies/Images/Delay/Card/Gallery/Audio/Video as chat bubbles; hides Actions/Smart Delay/Start Automation/Goals; conditions require manual branch choice; no contact/third-party data; no SMS/Email; Data Collection validation skipped; Multiple Choice / not-responded branches not previewable. `Restart` (= refresh) and `Auto-restart prompt` when automation modified; `Close` discards history. No persistence.
- **Full preview (In-App, GHL-style):** `Test with Contact` → pick contact from dropdown → `Run Test` executes full workflow via engine (`POST /api/automations/engine` already; add `POST /api/flows/test` mirror) including channels/webhooks; Execution Log shows per-step `success|failed|skipped` with detail; not perfect if same contact reused → advise publish + live contact for final verification. SMS/Email previews require phone/email input; charges apply semantics noted.
- **Where to find:** Preview button top-right with dropdown `In Manychat` vs `In messengers` equiv → `Quick Preview` vs `Test with Contact`.

### 2.9 Execution visualization / Analytics inline

- **Flow run history viewer** (`src/app/(dashboard)/automations/[id]/runs` / `flows/runs`) plus per-node stats: `Overall (entered) / Waiting (at node) / Passed (left node) | Total + Unique` for wait & input nodes.
- **Trigger stats:** Attempted / Matched / Unmatched with per-contact drill (30-day window, delete retains stats, editing disabled in Stats View).
- **Timeline:** `flow_run_events` rendered per run reverse-chronological (already shaped).

### 2.10 History / Versioning

- **Version History** icon top-right: list versions by timestamp + author + summary diff; `Restore` clones as new draft; waiting runs not migrated. P2 (HighLevel parity) — snapshot JSON of trigger + nodes on each save (incremental, not full graphify).

### 2.11 Templates / Reusable / Switcher / Shortcuts

- **Templates gallery:** `listFlowTemplates()` / automation templates filtered by `authoringChannel`; selecting clones (never links) — edits don't affect original (ManyChat broadcast clone semantic).
- **Reusable automations:** `Start Automation` (ManyChat, synchronous call without input wait) vs `Add to Workflow` via `Start Automation`+param passing — document: callee runs with same `trigger_channel` snapshot, trigger params passed via `vars`.
- **Switcher:** `Shift+W` palette to jump workflows (HighLevel) — P3.
- **Shortcuts:** `Cmd+Z/Shift+Z` undo/redo, `Cmd+C/V` copy/paste, `Shift+click` multi-select, `+` add step — keyboard help tooltip.

## 3. Persisted Shapes (for Save/Load/Publish contract)

- **Flows:** `flows {id, account_id, user_id, name, trigger_type, trigger_config JSONB (keywords/match_type/case_sensitive/channel), entry_node_id, fallback_policy JSONB, status, execution_count}` + `flow_nodes {flow_id, node_key, node_type, config JSONB (per-type incl channel_target), position_x/y}`. Reload via `GET /api/flows/[id]` → `validateFlowForActivation`.
- **Automations:** `automations {id, account_id, user_id, name, description, trigger_type, trigger_config JSONB, is_active, execution_count}` + `automation_steps {automation_id, parent_step_id, branch, step_type, step_config JSONB (incl channel_target for communication), position}`. Reload via `GET /api/automations/[id]` → `validateStepsForActivation`.

Every send node/step carries `channel_target: current|whatsapp|telegram` (required at publish per `validate.ts`; legacy null → `whatsapp` compat in runtime). Every trigger carries `channel: any|whatsapp|telegram` (optional filter). Future Instagram/Messenger add to CHECK without new table.

---
*Builder implements the capability model from `docs/specs/channel-capabilities.md` and node contracts from `docs/specs/node-system.md`.*
