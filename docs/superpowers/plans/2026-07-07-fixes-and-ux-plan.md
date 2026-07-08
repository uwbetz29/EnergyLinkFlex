# EnergyLink FLEX — Fixes + UX Plan (2026-07-07)

Investigation: 5-agent team (root-cause each reported bug, hunt for others, build the UX strategy) + controller live-browser evidence on prod. Framed with Spool's Kano model (basics → performance → delighters) and Chisnell's pleasure/flow/meaning.

## BLUF — the deeper story

Your 5 reported bugs are all confirmed with root causes. But the team also found that **three core "basics" are silently dead**, which per Spool are the real trust-killers in a multimillion-dollar-bid tool:
- **Export button is dead** — `editor-shell.tsx:353`, no `onClick`, nothing serializes SVG/PDF. The whole adapt-then-export purpose dead-ends.
- **Dimension edits never persist** — `updateDim` only mutates the Zustand store; no server save. Close the tab → the resized duct is gone.
- **Undo button is dead** — working `undo`/`redo` exist in the store but the top-bar button isn't wired.

And the **red-markup feature is itself visually broken** by the same style-leak that caused the white overlay: markup **text renders black** (not red) and **arrowheads are hollow/invisible**.

## Your 5 reported bugs — root causes

| # | Bug | Root cause | Fix |
|---|-----|-----------|-----|
| 1 | Black blobs are back | Exploded **HATCH fill** — LibreDWG tessellates hatch into thousands of sub-unit segments, each painted as a fixed 1px non-scaling black line → floods black at low zoom. Not `<use>` (stripAnnotationUses can't see it). The `HIDDEN_LAYERS` filter is **dead code** (LibreDWG drops layer attributes). | `dampenHatch()` string pass at ingestion: recolor short (<~0.35u) hatch segments to light gray. **Fable candidate.** |
| 2 | Can't select/delete line markup | Component boxes are `z-index:1 + pointerEvents:auto`; markup overlay is `z:auto` → boxes paint above the overlay and eat the click (`select(comp)` + `stopPropagation`). Delete isn't independently broken — it just never has a selection. | Gate box `pointerEvents` on tool: `pan → auto`, any markup tool → `none`; raise overlay `z:10` when active. |
| 3 | Can't select component under another | All boxes flat `z:1`, later-in-DOM wins; selected jumps to `z:5` and covers smaller boxes. No size priority, no way to reach occluded. | Resolve click by geometry: **smallest enclosing box first, click again to cycle outward.** (Figma idiom, no modifier.) |
| 4 | NL bar cramped/weak | 48px single-line input at bottom of drawer, no heading, no examples, 11px responses. | Redesign to **"Ask FLEX AI"** panel: heading + pitch, response area (scroll-capped, real success/caution/critical hierarchy), example chips, multiline composer + gradient **Apply** button. |
| 8 | Dimension popup sticks, Esc doesn't work | Editor opens but **focus stays on `<body>`** (autofocus not landing); Enter/Esc are wired only to the input's `onKeyDown` → nothing catches the key. **No global Esc, no click-outside dismiss.** | Reliable autofocus + global Escape while open + click-outside-to-dismiss + explicit ✕/Cancel. |

## Also broken — found while investigating (high severity)

| Sev | Issue | Fix |
|-----|-------|-----|
| **High** | Injected `<style>` leak ALSO hits markups: `text { fill:black !important }` → **markup text black not red**; `{ fill:none !important }` → **arrowheads hollow, drag-preview arrow invisible**. Same root as the white-overlay bug. | **Scope the injected CSS to the drawing** (`.elf-dwg` prefix on every selector). Retires the fragile `background:transparent` workaround too. |
| **High** | Any active markup tool (incl. the auto-selected "Select" after every draw) makes the overlay **eat ALL pointer events** → dimension-edit + component select silently die after drawing one markup. | After commit return tool to **pan** (not select); OR fall-through when select finds no markup. |
| **Med-High** | **Markups don't follow a stretch** — overlay viewBox frozen at load; stretch grows the drawing viewBox → a red arrow drifts off its target. Correctness risk on a bid. | Re-sync overlay viewBox after `applyAllStretches`, or remap markups. **Fable candidate** (coordinate remap + harness). |
| Med | Markups not in undo/redo → Cmd+Z reverts a *dimension* edit instead. | Unify markup ops into the history stack. |
| Med | Multi-sheet init never sets `svgUrl`/`currentSheet`/`sheetType` (stale comment) → multi-sheet DWGs load blank + first-sheet markups scope to wrong number. | `setSheets` → call `setActiveSheet(0)`. |
| Med | AI cascade fires on **every** dim edit — no debounce/abort, race-prone, metered cost/edit. | Debounce + AbortController + "checking…" indicator. |
| Low | Tool-switch with blank text input open snaps to Select; undo-button disabled-state read non-reactively; a11y labels on dim inputs. | Minor. |

## The plan (Kano-tiered, Chisnell-informed)

**Testing discipline (point 5, taken):** every fix is verified live on the real drawing via claude-in-chrome (draw/select/delete/stretch/export), not just `npm test`, before it ships. No "looks done" — evidence per fix.

### TIER 0 — Restore broken basics (trust). Chisnell: flow + meaning.

**Phase A — your reported bugs + their siblings (fast, one deploy):**
- A1 Black blobs → `dampenHatch()` (Fable) + delete dead `HIDDEN_LAYERS`.
- A2 Markup select/delete + component overlap → z-index/pointer-events gate + smallest-box cycle + zoom-invariant hit tolerance.
- A3 Markup visually broken (black text, hollow arrows) → scope injected CSS to `.elf-dwg`; retire the transparent hack.
- A4 Overlay eats all events after drawing → return-to-pan + select fall-through.
- A5 Stuck dimension popup → autofocus + global Esc + click-outside + ✕.
- A6 NL bar redesign → "Ask FLEX AI" panel.

**Phase B — dead basics (bigger, restore the core loop):**
- B1 Wire **Undo/Redo** button + Cmd/Ctrl+Z (store logic already exists — pure wiring).
- B2 **Persist dimension edits** to the server (mirror the markup debounce PATCH).
- B3 Wire **Export** → serialize the live SVG (with stretches + markups) → branded PDF stamped with the title block (`dwgMetadata`: drawing #, customer, scale).
- B4 **Save-state indicator** (Saving…/Saved) so durability is visible.
- B5 Markups follow a stretch (remap; Fable candidate).
- B6 Multi-sheet blank-canvas fix.

### TIER 1 — Performance payoffs (more-is-better).
- **Change ledger** panel: every changed dim old→new + cascade reasons, from `originals`+`history` (this is also the credibility artifact).
- AI cascade hardening: debounce/abort + surface `warn` severity (caution/critical) prominently.
- Sheet-switch viewBox fix (stop hardcoding 1600×900).

### TIER 2 — Delighters (earn "smarter than a CAD seat"). Chisnell: pleasure.
- **Before/after toggle** (store already has unused `showDiff`/`toggleDiff`).
- **One-click bid package**: drawing + change ledger + dimensions table, customer-branded.
- Post-cascade plain-language "what changed & why it's safe" summary.
- Resize/cascade micro-animations (flash the changed component).

## Fable usage
- **`dampenHatch`** (A1): durable, deterministic string→string transform with a clean harness (input SVG → assert short segments recolored, long ones untouched, counts). Ideal Fable unit.
- **markup remap-on-stretch** (B5): coordinate transform, harnessable (pre/post viewBox → markup coords stay on target).

## Open questions for Mike
1. **NL bar placement:** float it **bottom-center over the canvas** (always visible, works on P&ID too, more prominent) OR keep it embedded in the left drawer (simpler, but absent on P&ID)?
2. **Scope/sequence:** ship **Phase A** (your reported bugs + siblings) as a fast prod hotfix first, then do Phase B (Export/persist/undo) as a bigger follow-up? Or bundle A+B before deploying?
3. **Export format:** branded **PDF** with title block — confirm (vs PNG/SVG download).
