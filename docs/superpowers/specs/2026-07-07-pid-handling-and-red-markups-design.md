# P&ID Sheet Handling + Red Markups — Design Spec

> Status: draft for review. Author: Opus (session 6, 2026-07-07).
> Supersedes nothing. Related: [[architecture]], `annotations.ts` (the DWG's OWN
> callout blocks — a DIFFERENT concept from user "markups" below).

## Naming

This codebase already overloads **"annotation"** for the DWG's own callout blocks
(`isAnnotationElement`, `ANNOTATION_BLOCK_NAMES`, `CriticalFeature`, `CENTER LINE`,
`stripAnnotationUses`). The user-facing feature Mike calls "annotations" (red lines,
arrows, text a salesperson draws on a sheet) is named **markups** in code to avoid
collision. User copy may still say "annotations"; code/types say `markup`.

## 1. Problem

Two defects, addressed as one coherent feature:

1. **The app treats every DWG sheet as a resizable GA drawing.** The resize pipeline
   (AI pre-scan → section ID → stretch/scope) assumes a General Arrangement elevation
   with real `DIMENSION` entities. A **P&ID** (Piping & Instrumentation Diagram —
   schematic, e.g. real drawing `24189-CS1-0010`: 0 DIMENSION entities, 302 INSERT,
   HATCH/ACAD_TABLE/VIEWPORT) has nothing to resize. Running the GA pipeline on it makes
   the AI pre-scan **hallucinate sections** (and spend tokens), and offers a resize that
   produces garbage — unacceptable in front of a customer.

2. **A salesperson can't mark up a sheet.** For a non-resizable P&ID (and for GA sheets
   too), there is no way to draw call-outs onto the drawing for a bid.

## 2. Goal / non-goals

**Goals**
- Deterministically classify each sheet as **GA** (resizable) or **P&ID** (non-resizable)
  from data the parser already produces; gate the resize pipeline accordingly.
- A **red markup layer** on ALL sheets: create **line / arrow / text**, select, reposition
  (drag), edit text, delete. Static (never co-stretches with a GA edit) but pinned to the
  drawing through pan/zoom.
- **Persist** markups per sheet (the app's first edit-persistence path) so they survive
  reload and are part of the deliverable.
- **Zoom via explicit +/- buttons only.** Remove wheel/pinch scroll-zoom entirely; keep
  click-and-drag pan. Make the zoom controls prominent/obvious in the UI. (Rationale: the
  markup tool uses click-drag, so removing scroll-zoom keeps the canvas interaction model
  unambiguous — drag = pan/markup, buttons = zoom.)

**Non-goals**
- No co-stretching of markups with GA resizes (Mike chose "static").
- No rich text / fonts / colours beyond red (YAGNI). One colour, three shapes.
- No markup layering/z-order UI, grouping, or multi-select (YAGNI; single selection).
- No dedicated export/print path in this spec (markups live in the drawing coordinate
  overlay, so an existing screenshot/render path already captures them; a separate
  vector-export path is out of scope).

## 3. Behavioral model

### 3a. Sheet-type gate (decision table)

| Sheet has ≥1 usable `DIMENSION` entity | Schematic markers (HATCH/ACAD_TABLE/VIEWPORT) | `sheetType` | AI pre-scan | Stretch/dim UI | Badge |
|---|---|---|---|---|---|
| yes | any | `GA` | runs | shown | none |
| no | yes | `PID` | **skipped** | **hidden** | "P&ID — not resizable" |
| no | no | `PID` (generic) | **skipped** | **hidden** | "Not resizable — no dimensions" |

Rule: **resize requires dimensions**, so "no usable DIMENSION entity → non-resizable" is
both the detection and the correct gate. Schematic markers only refine the badge copy.
`GA` is the only type that keeps today's behaviour, so a real GA never loses resize.

### 3b. Markup tool (state machine)

Tool modes (toolbar): **Select** (default) · **Line** · **Arrow** · **Text**.

| Mode | pointer-down on empty | drag | pointer-up | on existing markup |
|---|---|---|---|---|
| Select | deselect | move selected markup by drag delta | commit move | select (click), edit text (dbl-click) |
| Line | begin line at pt | rubber-band end | commit `line{x1,y1,x2,y2}`, back to Select | — |
| Arrow | begin arrow at pt | rubber-band end | commit `arrow{x1,y1,x2,y2}` (head at end), back to Select | — |
| Text | place caret at pt, open editor | — | commit `text{x,y,text}` on blur/Enter (empty → discarded), back to Select | — |

Global: a selected markup + **Delete/Backspace** removes it. All markups render red
(`stroke/fill #e11d2a`, tunable const). Zero-length line/arrow (drag < tol) is discarded.

## 4. Units

### A1 — `classifySheetType(parseResult)` → `"GA" | "PID"` (Opus)
Pure, deterministic. New `src/lib/dwg/sheet-type.ts`. Input = the parse result's
`dimensions` + `entitySummary.typeCounts`. `GA` iff `dimensions.length >= MIN_GA_DIMS`
(default 1); else `PID`. A tiny `sheetTypeLabel(parseResult)` derives badge copy
(P&ID vs generic non-resizable) from the schematic markers.

### A2 — Persist `sheetType` on the sheet (Opus)
`DwgSheet.sheetType: "GA" | "PID"` added to `types.ts`. Computed at **parse time** (where
the full `parseResult` — `dimensions` + `entitySummary` — is in scope; `DwgSheet` itself
does NOT carry those inputs, so it cannot be classified post-hoc from the stored sheet) in
**both** parse routes: `parse/route.ts` (single-sheet, ~L62, beside `performPreScan`) and
`parse-multi/route.ts` (per sheet, ~L61). Rides the existing sheet jsonb — **no schema
change** for `sheetType`. Store exposes the active sheet's `sheetType`.

### A3 — Gate the pipeline + badge (Opus)
The AI pre-scan is **server-side** and runs at **upload** in `/api/dwg/parse/route.ts`
(`performPreScan`, ~L62) — it is NOT a client effect, and `parse-multi/route.ts` does not
run it at all. So the gate is in two distinct places:
- **Upload (`parse/route.ts`):** classify first; if `PID`, **skip `performPreScan`** (no
  hallucinated sections, no token spend). `parse-multi` only needs to store `sheetType`.
- **Client (editor):** when the active sheet's `sheetType === "PID"`, make the resize path
  fully **inert** (not merely hidden). The stretch/dimension affordance is distributed:
  do NOT populate stretch `components` / do NOT wire `setupDimensionClicks` in
  `svg-drawing-canvas.tsx`, and hide `ComponentSidebar` + `NLBar` in `editor-shell.tsx`
  (both are always-mounted for DWG today). Show the badge.
The markup toolbar is shown regardless (all sheets).

### B1 — `markup-geometry.ts` pure geometry (**Fable candidate** — see §8)
Pure, DOM-free, in overlay **viewBox** coordinates (see §6). The isolated, harnessable core:
- `hitTest(markups, pt, tol)` → topmost markup `id | null` under `pt` (point-to-segment
  distance for line/arrow; bbox for text). Deterministic top-most rule.
- `moveMarkup(markup, dx, dy)` → a new markup translated by a drawing-space delta.
- `arrowGeometry(x1,y1,x2,y2, headLen, headWidth)` → the two arrowhead line points (or
  polygon) at the `(x2,y2)` end, robust to zero/short shafts.
- `normalizeDrag(start, end, tol)` → `{x1,y1,x2,y2} | null` (null if below tol).

Screen↔drawing mapping is intentionally NOT here: the overlay `<svg>` shares the
drawing's viewport, so the React layer uses the browser `getScreenCTM()` for that
(no duplicated transform formula, no drift). Everything Fable-built is layout-free.

### B2 — Markup store slice (Opus)
`editor-store.ts`: `markups: Markup[]` (all sheets, keyed by `sheetNumber`),
`selectedMarkupId`, `markupTool`, and actions `addMarkup`, `updateMarkup`,
`deleteMarkup`, `selectMarkup`, `setMarkupTool`. Undo/redo integration is **out of
scope** for v1 (markups are their own simple CRUD; the existing dim-edit history stays
independent).

### B3 — `MarkupOverlay` React component (Opus)
A transparent `<svg>` mounted as a **sibling of the drawing container INSIDE the same
zoom/pan-transformed wrapper div** (`svg-drawing-canvas.tsx` ~L1602: a CSS `translate(...)`
on a div sized `realW = w*zoom × realH`; the drawing svg is injected at `width/height:100%`,
no CSS `scale()`), at `width/height:100%` and carrying the drawing's `viewBox`. It therefore
**inherits the identical transform for free** — do NOT re-derive `zoom/panX/panY`, which
would create a second, drift-prone transform path. Markup coords are the overlay viewBox
coords, so the layer stays pinned through pan/zoom while being immune to the stretch engine
(it is not a `*Model_Space` child). Renders markups from the store; pointer handlers
implement §3b using B1 for hit-test/drag and the overlay's `getScreenCTM()` for
screen→viewBox. Small toolbar (Select/Line/Arrow/Text) + inline text editor.

### B4 — Persistence (Opus)
- DB: new `dwg_markups jsonb` column on the projects table (migration/`ADD COLUMN
  IF NOT EXISTS`), storing `{ [sheetNumber]: Markup[] }`.
- Route: `PATCH /api/dwg/markups` (authed like the other dwg routes; validates payload,
  writes the column for the owning project). Load: `getProject`/`listProjects` in
  `src/app/projects/actions.ts` use **explicit `SELECT` column lists** + a typed `Project`
  interface, so the implementer must add `dwg_markups` to both SELECTs, to the `Project`
  type, and hydrate it in `EditorShell` — it will NOT "just return." The store hydrates
  `markups` on open.
- Save: debounced (~800ms) from the store on any markup change. This is the app's first
  write-back-of-edits path; it is markup-only (does not attempt to persist dim edits).

### C1 — Zoom controls: buttons-only, prominent (Opus)
Independent canvas-UX change, bundled here because the markup tool shares click-drag.
- **Remove** the wheel/pinch zoom handler in `svg-drawing-canvas.tsx` (the `wheel`
  listener, ~L1401–1447, which handles both wheel `deltaY` zoom and pinch via `e.ctrlKey`).
  No wheel or pinch changes zoom after this.
- **Keep** click-and-drag pan (the separate pointer-drag pan handler) unchanged.
- **Zoom only** via explicit on-canvas controls: a prominent, always-visible **zoom-in
  (+) / zoom-out (−)** cluster plus the existing % readout, and a fit/reset (`fitToView`,
  ~L1387) control. "Prominent" = a clearly styled, large-enough, always-visible control
  group (not a faint corner glyph). Reuse the existing `setZoom(zoom * factor)` action
  (~L1752) as the button behaviour; step factor 1.25 in / 0.8 out, clamped to the current
  min/max zoom.
- Applies to ALL sheets (GA + P&ID). Trackpad two-finger scroll no longer zooms; panning
  is click-drag only (matches "buttons only for zoom").

## 5. Integration / data flow

```
upload → parse[-multi]/route → classifySheetType(parseResult) → sheetType (jsonb)
   parse/route: if PID, SKIP performPreScan (server, upload-time) ────────────┐
                                                                              ▼
editor open → hydrate store (components, sheets, sheetType, markups) → canvas
   sheetType==='PID' → resize path INERT (no components/dim-clicks, hide
                       ComponentSidebar+NLBar), show badge
   MarkupOverlay (all sheets): tool state → B1 geometry → store CRUD
        store change ──debounced──▶ PATCH /api/dwg/markups ──▶ dwg_markups jsonb
```

## 6. Data model

```ts
type MarkupId = string;
interface MarkupBase { id: MarkupId; sheetNumber: number; }
interface LineMarkup  extends MarkupBase { type: "line";  x1:number; y1:number; x2:number; y2:number; }
interface ArrowMarkup extends MarkupBase { type: "arrow"; x1:number; y1:number; x2:number; y2:number; } // head at (x2,y2)
interface TextMarkup  extends MarkupBase { type: "text";  x:number;  y:number;  text:string; }
type Markup = LineMarkup | ArrowMarkup | TextMarkup;   // all rendered red
```
Coords are the overlay **viewBox** coordinates (exactly what the overlay svg's
`getScreenCTM()` yields for a screen point). **NOTE — this is NOT Model_Space:** the drawing
applies a Y-flip matrix `(1,0,0,-1)`, so viewBox Y = −(Model_Space Y). Markups never enter
the stretch engine, so they need no Model_Space conversion — store and render them purely in
viewBox coords (do not apply a Y-flip). Resolution-independent; pin correctly through pan/zoom.

## 7. Acceptance criteria — RED harness (Fable's reward signal for B1)

`src/lib/dwg/__tests__/markup-geometry.test.ts` (jsdom-free; pure):
1. `hitTest` returns the line/arrow whose segment passes within `tol` of the point, null
   otherwise; a point on the segment hits; a point `>tol` away misses.
2. `hitTest` on overlapping markups returns the **top-most** (last-added) deterministically.
3. `hitTest` on a text markup uses its bbox (given a text width estimate), not a segment.
4. `moveMarkup` translates every coordinate of each markup type by `(dx,dy)` and mutates
   nothing in place (returns a new object).
5. `arrowGeometry` head sits at `(x2,y2)`, is symmetric about the shaft, scales with
   `headLen/headWidth`, and degrades gracefully for a near-zero-length shaft (no NaN).
6. `normalizeDrag` returns null below `tol`, else an ordered `{x1,y1,x2,y2}`.

Golden/manual (Opus, after wiring): on a real P&ID SVG (`-CS1-0010`) `classifySheetType`
→ `PID`; on Sheet_2 → `GA`. A markup drawn, dragged, edited, deleted round-trips through
the store and the PATCH route (load returns what was saved).

## 8. Fable scope & operating-model plan

Per [[fable-operating-model]]: Opus contracts + writes the RED harness + verifies; Fable
builds the durable deterministic algorithm; the harness is the reward signal.

- **Fable-eligible unit: B1 `markup-geometry.ts`** — pure, layout-free, harness-backed,
  durable (no runtime LLM). It is the only farmable piece; everything else is React/store/
  DB/wiring that Opus owns.
- **Candid difficulty note:** B1 is *routine* 2D geometry (point-to-segment distance,
  vector translate, arrowhead trig) — materially easier than the axis-map / 2D-band
  composition Fable built before. The operating model says not to spend Fable on what Opus
  can trivially do. **Recommendation:** either (a) farm B1 to Fable at `effort: 'low'`
  purely to keep the module isolated + harness-first (cheap, exercises the pipeline), or
  (b) Opus builds B1 directly under the same RED harness. Decide at plan time; the harness
  (Opus's) is identical either way, so the choice is low-stakes. Default: **(b) Opus**,
  unless Mike wants the Fable path — because the ROI lever (hard reasoning × leverage) is
  low here.

## 9. File map

| File | Change | Owner |
|---|---|---|
| `src/lib/dwg/sheet-type.ts` | NEW — `classifySheetType`, `sheetTypeLabel`, `MIN_GA_DIMS` | Opus |
| `src/lib/dwg/types.ts` | `DwgSheet.sheetType`; `Markup` union | Opus |
| `src/lib/dwg/markup-geometry.ts` | NEW — pure hit-test/move/arrow/normalize | Fable-elig / Opus |
| `src/app/api/dwg/parse/route.ts` | classify + skip `performPreScan` on PID; set `sheetType` | Opus |
| `src/app/api/dwg/parse-multi/route.ts` | set `sheetType` per sheet | Opus |
| `src/app/projects/actions.ts` | add `dwg_markups` to SELECT lists + `Project` type | Opus |
| `src/app/api/dwg/markups/route.ts` | NEW — PATCH save markups (authed) | Opus |
| `src/stores/editor-store.ts` | markup slice + actions + hydrate | Opus |
| `src/components/editor/markup-overlay.tsx` | NEW — overlay `<svg>` + toolbar + text editor | Opus |
| `src/components/editor/svg-drawing-canvas.tsx` / shell | P&ID gate + badge + mount overlay; **remove wheel/pinch zoom (~L1401-1447); prominent +/- zoom controls** | Opus |
| DB | `dwg_markups jsonb` column (ADD COLUMN IF NOT EXISTS) | Opus |
| `__tests__/markup-geometry.test.ts`, `sheet-type.test.ts`, store tests | NEW | Opus |

## 10. Decisions
- Static markups (no co-stretch) — Mike, 2026-07-07.
- Persist with the project (full backend path) — Mike, 2026-07-07.
- Types: line + arrow + text (arrow added) — Mike, 2026-07-07.
- Name the feature `markup` in code to avoid the existing DWG-annotation collision — Opus.
- Screen↔drawing via `getScreenCTM()` (not a duplicated formula) — Opus.
- Zoom via prominent +/- buttons ONLY; remove wheel/pinch scroll-zoom; keep click-drag
  pan — Mike, 2026-07-07. (Buttons-only ⇒ trackpad pinch also removed.)

## 11. Open questions / risks
- **Pan/zoom mirroring:** the overlay must exactly reproduce the drawing's `zoom/panX/panY`
  application (pixel-size + translate, per svg-drawing-canvas). Risk: drift/misalignment.
  Mitigation: mount the overlay INSIDE the same transformed wrapper as the drawing so it
  inherits the identical transform, rather than re-deriving it. Pin the exact mechanism at
  plan time by reading the canvas transform code.
- **Text width for hit-test/bbox:** SVG text has no cheap measured width off-DOM. Use a
  monospace-ish estimate (chars × size × k) for `hitTest`; acceptable for selection.
- **First edit-persistence path:** new route + column + debounced save. Keep it markup-only
  and idempotent; do not entangle with dim edits.
- **Build order:** A (detect+gate) → B1+B2+B3 (in-memory markups) → B4 (persist). Each
  increment independently verifiable; ship-checkpoints between.
```
