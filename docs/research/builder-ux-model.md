# Builder UX — Interaction Model (ManyChat + HighLevel → ConvoxOS)

> Synthesized from `docs/research/manychat-model.md` + `docs/research/highlevel-model.md` (2026-08-31).
> VERIFIED where source docs support; otherwise UNCERTAIN.

## 1. Core Interaction Model — Channel-Neutral Canvas

### 1.1 Canvas

| Concern | ManyChat | HighLevel | Target ConvoxOS |
|---------|----------|-----------|-----------------|
| Layout | Visual map, auto-arrange, zoom, pan; minimap UNCERTAIN (likely present but not documented) | Infinite Canvas, Fit-to-Screen, Zoom, Minimap bottom-right — explicitly documented | Adopt HighLevel's infinite canvas contract using existing `@xyflow/react` already in repo; add minimap + fit button to Automations builder (Flows already have it) |
| Nodes move | Drag via handle, Shift+multi-select | 6-dot drag handle, Move here indicator, Shift+select implied | Unify on 6-dot handle + Move here (already in Flows) |
| Edges | Click dot → drag to target; Starting Step dot draggable to change entry | Click + on line → action picker inserts inline; visual loop prevention (arrow cannot return to previous step) | ConvoxOS Flows: dot→drag already; Automations: + to insert sequential. Add loop guard: sequential edge cannot create cycle back to ancestor (check BFS before accept) |

### 1.2 Node lifecycle

- **Create:** `+` icon / double-click empty → pick type → node appears at cursor with default config (ManyChat) / `+` on line → action picker (HighLevel). ConvoxOS: keep both patterns — canvas double-click + instrument bar for Flows; + inline button for Automations.
- **Selection:** Click node → side panel opens (config form). ManyChat right sidebar; HighLevel right-side Actions panel. ConvoxOS: side sheet / drawer already present — keep.
- **Editing:** Immediate inline edits + Undo/Redo (header buttons + Cmd+Z / Cmd+Shift+Z). ManyChat warns `Restart preview to reflect latest changes` when editing during preview. HighLevel red dot = unsaved. Target: show dirty state + undo stack (50 entries) + live validation.
- **Deletion:** Hover shows 🗑 / ×; click deletes. Must handle dangling edges: either reject delete if target still has inbound without fallback, or auto-reroute; HighLevel prevents leaving orphan without target. **Contract:** Deleting a node with inbound edges requires reconnect or becomes warning `unreachable`. Deleting a branching node requires branch reassignment.
- **Duplication:** ManyChat duplicate icon + Alt+drag copy; HighLevel copy/paste via shortcuts. Target: support Alt+drag duplicate + Cmd+C/V intra-automation and cross-automation (with config sanitized if target missing dependencies).
- **Validation states:**
  - Normal, Selected, Incomplete (missing required), Warning (unreachable), Error (blocking save/publish).
  - ManyChat channel mismatch → warning ("will never trigger") not hard error.
  - ConvoxOS `validateFlowForActivation` already uses `error|warning` with `severity` + `scope` — map to visual states directly.
- **Publish:** `Set Live` / `Publish` toggle top-right; draft allowed with incomplete graph; publish blocks if errors exist. ConvoxOS already: `is_active` / flow `status draft|active|archived`; add separate `saved` vs `published` independent flag (HighLevel model).

### 1.3 Preview & Testing

| Mode | ManyChat | HighLevel | ConvoxOS target |
|------|----------|-----------|-----------------|
| Quick (in-canvas) | `In Manychat` smartphone widget inside builder — no login, limited: no contact/third-party data (Tag conditions manual), no Dynamic/Google/Zapier, only current automation, no Actions/Smart Delay/Start Automation display or execution, no input validation, no SMS/Email | Not present — only full test with contact | Keep ManyChat-style quick widget for text/image/button flow validation; mark non-executable nodes as preview-only |
| Full (in-app) | `In messengers` — native chat app, login required, full execution incl integrations, SMS/Email phone/email input, charges apply | `Test Workflow` → select contact → Run Test → executes entire workflow + webhook → Execution Logs `Executed` | Use HighLevel-style Test with contact selector + dry-run; execute against real channel but isolated per test contact; show execution log inline |
| Live | Publish then use real contact | Publish then live trigger | Same; advertise "ideal test is publish + live contact" per HighLevel note |

**Preview limitations to document explicitly** (ConvoxOS Preview contract):

- Triggers not executed in preview (need real inbound)
- Non-content blocks (Actions, Smart Delay, Start Automation / Goals) not displayed/executed in quick mode
- SMS/Email channel limited
- Data Collection validation skipped in quick mode; Multiple Choice / not-responded branches not previewable
- Conditions manual in quick mode

### 1.4 Analytics / Execution Visualization

- ManyChat: per-step stats + drop-off, filterable by trigger; Smart Delay Overall/Waiting/Passed with Total+Unique.
- HighLevel: Stats View toggle + per-trigger Attempted/Matched/Unmatched + per-communication-action delivery/engagement + workflow-level expand stats; 30-day window; deleting action retains stats; editing disabled in Stats View.
- ConvoxOS: combine both — per-node attempted/matched/waiting/passed/failed; per-trigger enrollment stats; per-communication send/delivered/read/replied/failed (already in `broadcast_recipients` / `messages.status`); add 30-day filter.

### 1.5 Reusability & Templates

- ManyChat: folders + naming + `Start Automation` to chain modular automations (sync execute then return without waiting for input). `Broadcast From Automation` clones.
- HighLevel: `Add to Workflow` / `Go To` to move contacts between workflows, optionally passing trigger parameters; `Remove from Workflow`. Workflow Switcher (`Shift+W`) to jump quickly. Workflow Recipes = pre-built templates.
- ConvoxOS: support both `Start Automation` (sync call within one execution) and `Add to Workflow` via `Start Automation` equivalent + `Update Contact Field` as param passing; add Switcher shortcut and template gallery (already `templates.ts` exists for both engines — extend to clone-on-use).

### 1.6 AI Builder

- ManyChat: 8-step chat at bottom: business → goals → channel → template/intention → trigger → generate (≤30s) → Use or Back To Chat/Restart. Available for IG/Messenger/WhatsApp/Telegram.
- HighLevel: AI Prompt (GPT-3) action + AI Assistant that helps "understand and add right actions." No chat flow documented; likely command-palette suggestions.
- ConvoxOS: no canvas AI in target P1. Provide P3 slot: `Ask AI to build/edit` command palette that generates a single-node or small-graph diff with human review step, undoable, validation preserved — not a free-form full-automation generator.

## 2. Connection Contracts — Visual → Semantic

### 2.1 Edge types

| Type | ManyChat | HighLevel | ConvoxOS target |
|------|----------|-----------|-----------------|
| Sequential | Default Next | Line → + to add next action | Single `next_node_key` / `next_step_position`; validated presence; unreachable nodes flagged |
| Branch (Condition) | Matching vs Not matching | If/Else Yes/No branches | `true_next`/`false_next` (Flows) or `yes`/`no` (Automations); both must be wired for deterministic flow (warning if missing continuation) |
| Branch (Randomizer) | Up to 6 variations with % | Split test A/B | 2–6 outputs with % summing 100%; sticky vs every-time flag |
| Button/List | Each button/row owns `reply_id → next_node_key` | Not separate — content replies are channel replies that re-trigger via `interactive_reply` trigger | Flow: `buttons[].next_node_key` / list rows; Automation: `send_buttons/send_list` + `interactive_reply` trigger chaining across automations |
| Wait | Smart Delay → Choose Next Step (single) | Wait Step → next action (single) | Single `next_node_key`; previous timing suspension table holds resume pointer |
| Reusable (Start/GoTo) | Start Automation → after callee returns, next step single | Add to Workflow / Go To single target + optional param passing | Single next after return; callee reference by ID; deleting callee = broken reference warning |

### 2.2 Invalid states

- **Dangling edge** (next points to nothing): error at publish (ConvoxOS already checks `!knownKeys.has(next)`).
- **Unreachable node:** warning (Flows) / not formally documented for HighLevel but implied (grouping advice). ConvoxOS already warns.
- **Cycle:** ManyChat 30-block pause + HighLevel visual-loop prevention; ConvoxOS: add cycle detection (DFS) — publish error if cycle without wait/condition escape.
- **Duplicate IDs:** Flow `node_key` duplicate error, Automation `position` ordering.
- **Channel mismatch:** warning not error for trigger vs node channel (see §3).
- **Duplicate reply_ids:** error (Flows already enforces per node).
- **Deleting connected nodes:** see §1.2 — require reconnect or warn.

## 3. Channel Capability Display in Builder

ManyChat maps: availability depends on **instrument bar filtered by selected channel node**; unsupported blocks hidden. When multiple channels connected, text block type is chosen explicitly per channel (Messenger block vs Instagram block vs WhatsApp block). Automation can contain messages across multiple channels "in any sequence, as long as the channel is activated."

ConvoxOS maps to authoring controls already shipped (Phase F): `FlowEditorProvider` `authoringChannel any|whatsapp|telegram` derived ephemerally, not persisted; `TriggerPanel` channel Any/WhatsApp/Telegram; `ChannelTargetRow` Current|WhatsApp|Telegram per send node (locked WhatsApp for `send_template`). **Contract:** builder uses canonical matrix (`docs/specs/channel-capabilities.md`) to hide/disable unsupported options per selected/target channel; validation mirrors hide rules so hidden ⇒ publish errors cannot be bypassed via API.

## 4. What ConvoxOS Builder Needs to Change (summary)

- Add minimap+fit+zoom to Automations builder (Flows already has xyflow).
- Unify dirty/saved/published state (red dot + separate draft/published toggle).
- Add per-node Incomplete/Warning/Error visual states wired to existing `ValidationIssue` scopes.
- Add Alt+drag duplicate + cross-automation copy/paste with sanitized refs.
- Add `In Manychat`-style quick preview widget (limited) + keep HighLevel-style contact-selector full test.
- Add cycle detection + dangling/unreachable guards to publish validation (partial already present).
- Add Version History snapshot on save (HighLevel parity, P2).
- Add Workflow Switcher (`Shift+W`) for Automations (P3).
- Add AI command-palette slot (P4).
