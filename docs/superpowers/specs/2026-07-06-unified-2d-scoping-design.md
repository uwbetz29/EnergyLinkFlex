# Unified 2D Scoping Engine — Design Spec

- **Date:** 2026-07-06 (rev. 2026-07-07 after independent spec review + two offline feasibility spikes)
- **Status:** Draft rev.2 (pending user review)
- **Owner split:** Opus = contract + verify + all wiring/U1/U3/U4. Fable = **U2 only** (the hard 2D band composition). Per `fable_operating_model`.
- **Supersedes/extends:** `2026-07-06-spatial-scoping-design.md` (1D X-gutter view model), `2026-07-06-nested-zone-stretch-design.md` (Package A segment-map engine). Resolves parked Package B (`package_b_parked`) and the deep-#3 follow-up (`live_qa_session4`).
- **Rev.2 changes:** U3 detection method changed from morphological-open (empirically disproven, see §11) to **cross-axis gap detection** (empirically validated). Fable scope narrowed to U2. Composition/boundary/invariant/threshold fixes from the two-reviewer pass folded in (§ marked ⟲).

---

## 1. Problem

`applyMultiStretch` scopes a width (X) stretch to the correct **view** (`viewRegion.{xMin,xMax}` skip at `svg-stretch.ts:534`) but **within** a view scales the *full-height* X-band: an element in the zone's X-range is scaled regardless of Y (it only runs `placeOnAxis(g.segments, c)` at `:536-537`, with no Y exclusion). Two real defects on 24081:

1. **Intra-view ovaling (deep #3).** A width edit on a horizontal component scales the full-height band, ovaling the stack/silencer stacked above it in the same elevation (round → oval). Today's only guard is `MAX_STRETCH_RATIO=2.5`, which merely *refuses* gross edits.
2. **Detached-detail distortion (Package B).** On Sheet_3, a horizontal duct stretch whose zone crosses the detached ammonia skid would oval the skid's pumps and widen it while its own dimension stays fixed.

The engine scopes to the right view but not the right **cross-axis band**, and has no concept of a detached rigid sub-assembly.

## 2. Goal / non-goals

**Goal.** Add **2D (cross-axis) scoping**: a stretch deforms only its target's band; everything else holds rigid or translates as a unit. Kills intra-view ovaling AND detached-detail distortion, with a WARN safety-net when a detached body can't be isolated confidently. Output stays sales-grade, not CAD-exact.

**Non-goals.** Not re-solving nested-zone interior composition (Package A `axis-map.ts` already does that; this composes with it). Not perfect reflow — small gaps/overlaps at a rigid/scaled interface are acceptable (Decision D1). No runtime LLM (all four units are deterministic; Fable is build-time only).

## 3. Behavioral model — total decision table ⟲

Definitions. A stretch has axis **A** (stretch axis) and cross axis **C**; zone `[near,far]` on A; the composed piecewise A-map from `buildAxisMap` (Package A). The target's **cross-band** `[cLo,cHi]` on C comes from U1. Band membership is **half-open with tolerance**: `c ∈ band ⟺ cLo − AXIS_TOL ≤ c < cHi + AXIS_TOL` (`AXIS_TOL=6`, matching the rest of the engine). Each element's A-position `a` sits `before` (`a < near−AXIS_TOL`), `in` (`near−AXIS_TOL ≤ a ≤ far+AXIS_TOL`), or `after` (`a > far+AXIS_TOL`) the zone. `axisGrowth(segments)` is the map's tail offset (NOT the raw edited delta — see I2).

Every Model_Space element gets **exactly one** row (evaluated top to bottom; first match wins):

| # | Condition | Transform |
|---|---|---|
| 1 | is annotation (`isAnnotationElement`) | existing annotation rule (ride map with scale 1 = `annTranslate`); never scaled |
| 2 | ∈ a **detached body** (U3), body wholly `after` on A | translate the whole body by `axisGrowth` (rigid unit) |
| 3 | ∈ a **detached body** (U3), otherwise | hold rigid (identity) |
| 4 | `c ∈ band` (target's cross-band) | run the composed A-map: `placeOnAxis(segments, a)` (scale within zone, tail-translate if `after`, identity if `before`). This is the intended resize + nested interior composition. |
| 5 | `c ∉ band` and `a` is `after` | translate by `axisGrowth` on A only, scale 1 (identical offset to row 4's `after` case — guarantees I2) |
| 6 | `c ∉ band` and `a` is `in` or `before` | hold rigid (identity) — the stacked neighbour; never scaled → circles stay round |

Precedence note ⟲: detached-body rows (2–3) win over band rows (4–6), so a detached detail that happens to lie inside the target's cross-band is still held rigid (not scaled), and — if it sits inside an actively-scaling band — U4 emits WARN (§7) rather than open a silent seam. **Annotation exception:** an annotation whose position lies inside a detached body's bbox follows that body's rows (2–3), i.e. moves rigidly with its body, NOT row 1 — otherwise a label could desync from its translated body (e.g. label `before` the zone while its body is `after`). All other annotations use row 1. Cross-axis symmetry: a height (Y) stretch swaps A↔C.

**Multi-stretch composition ⟲.** `applyMultiStretch` composes N zones (multi-dim / multi-component edits) additively per element (`sx*=sc; tx+=t`). Each zone carries its **own** `crossBand`; the table is evaluated **per zone** and the per-axis results accumulate exactly as today. An element in zone i's band but not zone j's receives zone i's scale and zone j's translate-only — no special cross-zone coupling.

**Invariants.**
- **I1 (no non-target distortion):** no element in rows 1,2,3,5,6 is ever scaled on any axis; rigid bodies preserve bbox aspect ratio exactly.
- **I2 (connectivity) ⟲:** every element `after` the zone on A translates by exactly `axisGrowth(segments)` — the SAME value for in-band (row 4) and out-of-band (row 5) elements — so no seam opens across the downstream section. (Restated from rev.1's false "translates by exactly d"; downstream offset is the map tail, not the raw edited delta.)
- **I3 (dimensional truth):** T's edited dimension reads the requested value after re-valuing; a held rigid body's own spanning dimension is unchanged.

## 4. Units

### U1 — `computeComponentBand(target, svgEl)` → `{ aRange:[near,far], crossBand:[cLo,cHi] } | null` (Opus) ⟲
Derives T's stretch-axis zone and cross-band from **real dim-block geometry**. Reuses session-4's `getDimBlockBounds`/`dimBlockBox2D`/`deriveComponentBoxes`. **These are currently private closures inside `svg-drawing-canvas.tsx` — a prerequisite task extracts them into an exported module** (`src/lib/dwg/dim-geometry.ts`) so U1 (and the harness) can call them; the canvas imports from there (behavior-preserving refactor, its own step in the plan). Returns `null` when the target has no dim block on the stretch axis (caller skips, matching today's `getDimBlockBounds` failure at `svg-drawing-canvas.tsx:1173`). Cross-band from the on-C extent of T's measured geometry; 2D-bbox fallback when a dim gives only one axis. Operates on **original (pre-transform) coordinates**.

### U2 — 2D band classification in the segment-map application (**Fable**) ⟲
Implements §3 rows 4–6 inside `applyMultiStretch`. Scope of change is **both** layers, explicitly:
- **Grouping/classification (`svg-stretch.ts:442-501`) — explicit rule change:** `crossBand` joins the group key: `regionKey = (axis, viewRegion, crossBand)`. The existing disjoint/nested/coincident classification (`:450-465`) and the `buildAxisMap` merge (`:490-493`) run **only among specs sharing that full key** (same axis AND viewRegion AND crossBand). Two specs that differ in `crossBand` are treated as **automatically disjoint** — they never enter the A-overlap/containment test against each other (skip the `:450-465` comparison entirely), and each forms its own group with its own `buildAxisMap`. This prevents rev.1's bug where two same-axis zones at different heights were wrongly judged overlapping/nested (and one dropped at `:464-465`). (Rev.1 named only the per-element loop; this is the missing grouping-rule edit.)
- **Per-element application (`:520-547`):** compute the element's cross-position `c'` (the coord on C, which the loop does not compute today), then apply the §3 table. Out-of-band `after` elements use the map's tail offset (row 5 = row 4's `after`), never a hand-rolled delta. `sumV`/`sumH` viewBox growth accounting is unchanged (computed from the map, not per element).
`StretchParams`/`Spec` gain `crossBand?: { lo:number; hi:number }` and `crossAxis?: 'x'|'y'`.

### U3 — `detectDetachedAssemblies(modelSpace)` → `Array<{ bbox, confidence }>` (Opus) ⟲ [method changed]
**Cross-axis gap detection** (generalizes `computeViewRegions`' X-gutter to 2D, thin-bridge tolerant). On each axis, bin equipment `fastPosition` points (annotations excluded) into slices; a **corridor** is a run of slices whose density `< EMPTY_FRAC × median_slice_density` (thin bridges — a few pipe elements — stay under the threshold). A compact cluster on the far side of a corridor from the main mass is a detached candidate. `confidence = clamp( (median_density / max(corridor_density, ε)) normalized, corridor_width / MIN_CORRIDOR_WIDTH )` → high when the corridor is both very empty and wide. Provisional tunables (from §11 Sheet_3 data): `EMPTY_FRAC=0.05`, `MIN_CORRIDOR_WIDTH ≈ 3 median slices`, `CONF_MIN=0.6`. Deterministic (no random/time); ties by coordinate order. Computed once per SVG load on **original coordinates**; cache invalidates on SVG identity change only. (Erosion/morphological-open was tried and empirically fails — see §11.)

### U4 — Safety net + WARN policy (Opus) ⟲
Retains invariant rollback, `MAX_STRETCH_RATIO` gross-distortion guard, `validateDimValue`. **WARN** (`setStretchWarning` "Detached details present — review manually", no silent distortion) fires when **either**: (a) a U3 candidate with `confidence < CONF_MIN` straddles the active zone (bbox A-interval overlaps `[near,far]`), or (b) a **high-confidence** detached body lies inside an actively-scaling band (row 2/3 vs row 4 conflict) — so a rigid body inside a scaling region is flagged, not silently seamed. `MAX_STRETCH_RATIO` stays a global post-check for now; because 2D scoping scales far fewer elements, a shrink (negative delta) whose target band legitimately exceeds `1/2.5` still rolls back — G4 (§7) pins this expected behavior.

## 5. Integration / data flow ⟲

Dim edit → build stretch specs (`applyAllStretches`, `svg-drawing-canvas.tsx`) → U1 `computeComponentBand(target)` per edited component + U3 `detectDetachedAssemblies(modelSpace)` (cached) → **the single** `applyMultiStretch` call (`svg-drawing-canvas.tsx:1242`) with per-zone `crossBand` + detached bodies → U4 safety-net check → render, or WARN + rollback. (There is exactly one `applyMultiStretch` call site; the other three `postProcessSvgDom` sites at `:541,1138,1394` are load/undo/rollback resets, not stretch paths.)

## 6. (reserved)

## 7. Acceptance criteria — RED black-box harness (Fable's reward signal) ⟲

Against the **public** API only. Fable may NOT edit any test/fixture (anti-cheat). Thresholds pinned to concrete measurables:
- aspect-ratio drift = `getBBox().width/height` ratio delta `< 0.01` (harness renders nodes in jsdom to read `getBBox`);
- downstream translate tolerance = `AXIS_TOL` (6 units);
- dim equality = exact string match after `formatDimInches` (16th-inch grid).

**G1 — Sheet_2 intra-view (real 24081 Sheet_2):** width edit on a mid component → neighbour circles outside T's cross-band keep aspect-ratio within 1% [I1]; T's dim reads the requested value [I3]; every `after` element translated by `axisGrowth` within `AXIS_TOL`, in-band and out-of-band alike [I2]; the two elevations still co-stretch.

**G2 — Sheet_3 detached skid (real 24081 Sheet_3):** horizontal duct stretch whose zone crosses the skid → skid pump circles keep aspect-ratio within 1% [I1] (**held by U2's Y-band scoping — the skid is Y-separated, §11**); main duct stretches to the requested length [I3]; skid's own spanning dimension unchanged [I3]. (Passes via U2 alone; U3 is exercised separately.)

**G3 — U3 detection + WARN:** on real Sheet_3, `detectDetachedAssemblies` returns the skid bbox with `confidence ≥ CONF_MIN`; a synthesized low-confidence blob straddling a zone → WARN emitted, zero elements in the blob scaled.

**G4 — shrink:** negative-delta edit on a component → in-band geometry shrinks, neighbours unchanged; if the band scale drops below `1/MAX_STRETCH_RATIO`, the whole edit rolls back with the generic warning (pins the ratio-guard interaction).

**Unit:** U1 band from fixture dim blocks + `null` on missing-axis dim; U2 table rows 1–6 on synthetic Model_Space incl. band-boundary (`c==cLo`, `c==cHi±AXIS_TOL`) and the `after ∧ in-band` case; U3 gap detection on synthetic (clean-gap, thin-bridge, no-gap) + real Sheet_3; U4 both WARN triggers.

**Regression:** full suite green (currently 98) + `tsc --noEmit` 0 + eslint 0 errors; existing nested-zone + spatial-scoping goldens (`scripts/qa/*.mjs`) still pass.

## 8. Fable scope & operating-model plan ⟲

- **Farm to Fable:** **U2 only** — the 2D band classification, including the grouping-layer `crossBand` threading and the per-element table. This is the hard, uncertain composition reasoning. Packet = this spec + RED harness + exact `StretchParams`/`Spec` signatures + run commands. `effort:'medium'` via a one-stage Workflow, self-verify to green; escalate a specific plateaued case to `high` only.
- **Opus builds:** U1 (+ the dim-geometry extraction refactor), U3 (gap detection — de-risked in §11), U4, the RED harness, and independent verification (full suite + tsc + lint + G1/G2/G3/G4 on real drawings Fable never sees + adversarial diff read) before accepting.

## 9. File map ⟲

- `src/lib/dwg/dim-geometry.ts` (new) — extracted+exported `getDimBlockBounds`/`dimBlockBox2D`/`deriveComponentBoxes`; `computeComponentBand` (U1). Canvas imports from here.
- `src/lib/dwg/svg-stretch.ts` — `StretchParams.crossBand`/`crossAxis`; U2 grouping + per-element classification.
- `src/lib/dwg/detached.ts` (new) — U3 `detectDetachedAssemblies` (gap detection) + tunables.
- `src/components/editor/svg-drawing-canvas.tsx` — wire U1/U3 into `applyAllStretches` (the one `applyMultiStretch` call); U4 WARN triggers via `setStretchWarning`.
- `src/lib/dwg/__tests__/` — U1–U4 unit + guard tests; `scripts/qa/` — G1–G4 goldens on real drawings.

## 10. Decisions

- **D1:** partial cross-band overlap → hold the neighbour rigid (favor no-distortion over no-gap). Sales-grade.
- **D2:** WARN triggers = low-confidence straddle OR high-confidence detached body inside an actively-scaling band (§7 U4).
- **D3:** cross-band + detection derive from real geometry (dim blocks / `fastPosition`), never the AI pre-scan estimates.
- **D4:** U1/U3 operate on original pre-transform coordinates; classification is against original coords (engine premise), so per-load caching is valid.

## 11. Feasibility spikes (offline, real drawings)

- **U3 morphological-open — DISPROVEN.** Binary-eroding the occupancy grid by radius `r` never yields {whole main} + {distinct skid}: `r=0` merges skid+main via the thin pipe or over-segments; `r≥1` shreds the main assembly AND destroys the sparse skid (it erodes before dense spline regions do). No `(cell,r)` separates them — same cell-size dilemma the parked probe hit (`erode-probe.mjs`).
- **U3 cross-axis gap — VALIDATED.** The Sheet_3 Y-projection shows the main flow dense over Y[178,663], a **near-empty corridor Y[681,793]** (counts 8–95 vs 500–4300; only the thin pipe crosses), and the **skid distinct at Y[812,849]**. Gap detection isolates the skid cleanly and yields the confidence formula in §4/U3 (`spike2-detect.mjs`). Density-threshold connectivity and DWG-block membership both failed (skid is raw geometry, no INSERT).
- **U2 covers the real drawings.** Because the skid is Y-separated, U2's cross-band scoping already holds it rigid (G2). U3 earns its keep only for a hypothetical detached detail that shares the target's cross-band; gap detection generalizes to that (on-A-axis corridor within the band).
