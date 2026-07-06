# Spatial Scoping for the DWG Stretch Engine, Design Spec

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Repo:** EnergyLinkFlex (branch `wip/dwg-ai-stretch-checkpoint`)
**Punchlist item:** #5 (per-view spatial scoping) from `offline_lab_findings.md`

## Problem

The element-level SVG stretch engine (`src/lib/dwg/svg-stretch.ts`) classifies
elements by a single axis **globally**. A height change scales/translates every
element in a full-width Y-band; a width change scales every element in a full-height
X-band. The Titan GA drawing (`24081-CS1-0001 Sheet_2`) has **two side-by-side
elevations** (near-side + end), so a global band reaches the companion elevation.

Measured on the real SVG (linkedom): a silencer +4 ft (vertical, zone y
`[531.3, 627.3]`) transforms **1,124 elements in the end elevation** (70 scaled,
1,054 translated). Two distinct behaviors are tangled in that number.

**Height (vertical) changes are mostly correct.** Both elevations share the ground
datum: every end-view dimension's zone also starts at y approximately 291.5. Equipment
in both views should rise together when height is inserted. The genuine defect is that
**annotations** (dimension `<use>` blocks whose anchor lands in the zone, and their text
glyphs) get **scaled**. Example: the overall `4000 STACK` dim, anchored at y approx
591.5 inside the silencer zone, has its number glyphs vertically distorted. Dimension
*values* are already correct: the conservative re-value rule (`revalueSpanningDims`,
punchlist #7) only bumps dims that fully span the zone, so a companion dim like the
end-view `21'-3"` (zone `[291.5, 546.5]`, does not span) stays `21'-3"`.

**Width (horizontal) changes are wrong.** The two views show different horizontal
quantities (near = width, end = depth); they are not X-aligned. A global X-band width
change slides/distorts the companion elevation. This is Finding 7's gap #2.

## Confirmed requirements (decisions taken during brainstorming)

1. **Derivation is deterministic geometry.** No AI, no gateway creds. View regions and
   per-element classification come from the SVG geometry, so the whole feature is
   verifiable offline against the real drawing.
2. **Height change:** equipment rises together in all views (both silencers grow); the
   fix is that annotations must not distort.
3. **Width change:** affects only the edited view; the companion elevation is untouched.
4. **Architecture is axis-differentiated,** not a uniform per-view box for both axes. A
   full per-view box on height is unnecessary and risks breaking the desired both-views
   height consistency.

## Empirical grounding (measured on the real drawing)

Projecting the ~75,307 equipment element X-positions (annotations excluded) into 40
bins shows a clean, wide **gutter** with zero equipment at x approximately
`[816, 977]`, separating:

- **View 0 (near elevation):** x approx `[91, 816]`, dense body peak at x approx 735.
- **View 1 (end elevation):** x approx `[1017, 1477]`, peaks at x approx 1178 and 1259.

This confirms `computeViewRegions` is feasible via gap detection. It also fixes the
tuning basis: the histogram was built from `fastPosition(child).x`, which for a `<g>`
wrapper is the first child primitive's X (the same approximate basis the existing zone
classifier already uses), so the gutter threshold must be tuned against `fastPosition`
output, not an idealized centroid or bounding box.

## Design

Four units, each independently testable.

### 1. View model, `src/lib/dwg/view-model.ts` (new)

Deterministic partition of Model_Space into view regions by X.

- `computeViewRegions(modelSpace: Element): { xMin: number; xMax: number }[]`
  - Collect `fastPosition(child).x` for **equipment** children (annotations excluded so
    dimension gutters do not blur the split).
  - Sort X; find the large empty gap(s) that separate side-by-side elevations. Split
    threshold: a gap larger than a multiple of the median inter-element X-gap, a named
    constant pinned by verification against the real geometry (the confirmed gutter at
    x approx `[816, 977]` is the reference; expected result is 2 regions).
  - Return contiguous `[xMin, xMax]` intervals, one per view.
- `viewOf(x: number, regions): { xMin, xMax } | null`, the region containing `x`. If `x`
  falls inside a gutter, return the nearest region; ties (equidistant, e.g. exact gutter
  midpoint) resolve to the **left** region for determinism.
- Pure functions, no DOM mutation. Result cached per SVG in the caller (recompute is
  cheap but caching avoids repeating on every stretch pass).

Fallback: if only one region is found (no clear gutter, or a P&ID sheet), the feature
degrades to current global behavior, which is safe.

### 2. Annotation classifier, `isAnnotation(el: Element): boolean`

True when the Model_Space child is, or wraps, a dimension `<use href="#*D…">`, a
`<text>`, or a known annotation-symbol `<use>` (CriticalFeature, CENTER LINE, Borders,
Title Blocks, 2dTransSection, Datum Identifier, and the rest of the render-strip list).
Everything else is equipment.

**Single source of truth for the block list.** Today that knowledge lives in the canvas
render path split across three shapes: the `ANNOTATION_BLOCKS` Set, the
`href.includes("Border" | "Title Block" | "PROJECTION" | "2dTransSection")` substring
checks, and `href.startsWith("Datum Identifier")` in `postProcessSvgDom`
(svg-drawing-canvas.tsx lines approx 154-218). To avoid a second copy drifting, extract
that predicate into one shared helper (e.g. `isAnnotationBlockName(href)` in
`view-model.ts` or a small shared module) and have **both** `postProcessSvgDom` and
`isAnnotation` call it. `isAnnotation(el)` wraps that predicate plus the `<text>` and
`<use href="#*D…">` checks.

### 3. Stretch rules, `applyMultiStretch` (`svg-stretch.ts`)

`StretchParams` gains an optional `viewRegion?: { xMin: number; xMax: number }`, set by
the caller for **width** stretches only (the edited dim's view). Height stretches leave
it undefined.

Per Model_Space child, per active spec:

| Element kind | Height (vertical) spec | Width (horizontal) spec |
|---|---|---|
| Equipment | scale in-zone / translate above-zone, **global (all views)** | scale/translate, **only if `x` in `viewRegion`** |
| Annotation | anchor-classified translate: past-zone gets +delta, in/before gets 0; **never scale** | same anchor-classified translate on X, **only if `x` in `viewRegion`** |
| Outside `viewRegion` | height is global; not applicable | untouched |

Both annotation cells use the same before/inside/after anchor logic as equipment
(translate by delta only when the anchor is past the zone along the stretch axis); the
only difference from equipment is that annotations never receive a scale factor. This
keeps a companion dim whose anchor is below the zone (e.g. the `21'-3"` at anchor y
approx 419) fixed, while an annotation above the raised zone rides up with the
equipment.

Per-element results still compose into a single `translate(tx,ty) scale(sx,sy)` exactly
as today (X/Y independent; disjoint-zone accumulation unchanged). The nested-zone guard,
witness handling, and viewBox growth are unchanged.

### 4. Wiring, `applyAllStretches` (`svg-drawing-canvas.tsx`)

- Compute `viewRegions` once per stretch pass (cache on the SVG element).
- When queuing a **horizontal** stretch, set `viewRegion = viewOf(dimX, regions)` where
  `dimX` is the edited dim block's X position (from `getDimBlockBounds` for width dims).
- Vertical stretches: no `viewRegion`.
- `revalueSpanningDims` and `setDimBlockText` (punchlist #7) run unchanged afterward.

### Data flow

dim edit, then `applyAllStretches`, then compute view regions, then queue
`StretchParams` (width specs tagged with `viewRegion`), then `applyMultiStretch` applies
the axis-differentiated, annotation-aware rules, then `revalueSpanningDims`, then render.

## Verification (offline, linkedom, real `24081-CS1-0001 Sheet_2.svg`)

1. **View model:** returns exactly 2 regions with the gutter at x approx `[816, 977]`;
   known dims land in the expected view (near-view stack dim in region 0, end-view
   `21'-3"` dim in region 1). A P&ID / single-cluster input yields 1 region (global
   fallback).
2. **Annotation classifier:** dim `<use>`, text, and annotation-symbol blocks classify
   as annotation; equipment lines/paths classify as equipment (spot-checked counts).
3. **Height stretch (silencer +4 ft):** companion-view **annotation** elements receive
   **zero scale** (translate-only); **equipment** classification/transform still matches
   current behavior (regression check over the ~75 k elements); the end-view `21'-3"`
   dim block is not partial-scaled.
4. **Width stretch (a near-view width dim):** zero transforms land on elements outside
   the edited view region; the companion elevation is untouched; the edited view's
   equipment still scales.
5. `tsc --noEmit` clean.

## Out of scope (YAGNI)

- Perfect regrowth of the governing dimension's extension/witness lines to the new
  length (they stay rigid; the value is already re-valued by #7, sales-grade).
- AI involvement of any kind.
- Special handling for more than 2 views (gap-clustering handles N generically; only 2
  expected).
- Non-datum-aligned views (the target drawing is datum-aligned; if a future drawing is
  not, height scoping would need revisiting, noted as a risk, not built now).

## Risks / open questions

- **Gutter detection robustness:** the X-gap threshold is tuned to this drawing.
  Mitigation: single-region fallback to current global behavior; the threshold is a
  named constant that verification pins against the real geometry (gutter at x approx
  `[816, 977]`).
- **Annotation classification completeness:** if an equipment element is misclassified
  as annotation (or vice versa) it would translate instead of scale (or scale instead of
  translate). Mitigation: the classifier is a small enumerable rule set (shared with the
  render path) validated by the spot-check in verification; misclassification is visually
  obvious in a render.
- **Anchor-based annotation translate for in-zone dims:** a dimension whose anchor sits
  inside the zone translates by its anchor classification rather than growing. Accepted:
  the value is correct (#7); the line length is sales-grade, not CAD-exact.
