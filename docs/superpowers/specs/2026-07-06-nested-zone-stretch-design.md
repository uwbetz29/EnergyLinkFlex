# Nested-Zone Stretch Composition — Design Spec

- **Date:** 2026-07-06
- **Status:** Draft for review (rev 2 — folds in spec-review round 1)
- **Owner (contract + verification):** Opus (orchestrator)
- **Implementer (algorithm):** Fable 5 (build-time only; see Durability)
- **Area:** `src/lib/dwg/svg-stretch.ts` (`applyMultiStretch`)

## BLUF

`applyMultiStretch` today refuses overlapping same-axis stretch zones: it keeps
the first and `console.warn`-skips the rest ("nested-zone spatial scoping not yet
supported", svg-stretch.ts ~L370). The real customer drawing hits this exact case
— the overall `4000 STACK` zone y[291.5, 891.5] (50'-0") fully **contains** the
silencer zone y[531.3, 627.3] (8'-0"). This spec replaces the skip with a correct,
general **nested-zone composition engine**: compose an arbitrary set of same-axis
interval stretches (disjoint OR properly nested) into one correct monotonic
piecewise-linear coordinate map per axis, applied per element, preserving every
existing rule (annotation-hold, view-region scoping, invariants, undo). It supports
both product behaviors — *derive* and *redistribute* — as **inputs** to one engine,
not two engines.

## Durability constraint (non-negotiable)

The implementer (Fable) is available at BUILD time only, never at runtime. This
feature is **pure deterministic geometry with zero runtime LLM**, durable by
construction: once baked into tested code it runs forever with no dependence on
Fable. Any design that would put a model in the runtime path is rejected.

## Coordinate conventions (must be respected exactly)

LibreDWG SVG has a `matrix(1,0,0,-1,0,0)` Y-flip on the wrapper `<g>`, so
Model_Space internal coordinates are **Y-up**. `applyMultiStretch` normalizes each
stretch to a 1-D interval in Model_Space coords:

- **vertical:** internal `far = -svgBounds.top`, `near = -svgBounds.bottom`
  (near = lower on screen = scale origin). Internal Y increases upward.
- **horizontal:** `near = svgBounds.left`, `far = svgBounds.right` (no flip).

Elements are classified by `fastPosition(el)`, which reads **geometry attributes,
never the transform**, so every element is classified against ORIGINAL coordinates.
This must remain true — it is what makes the result exact and order-independent.

Constant `TOL = 6` SVG units (matches the revalue tolerance) is the edge-snapping
and containment tolerance throughout.

---

## Composition model (NORMATIVE — this governs; supersedes the old per-spec loop)

The current per-spec accumulation loop (`for (const sp of kept)`, L421–441) is
**replaced** by a single **axis map** per axis. This removes all ambiguity about
what a container contributes in each region. For disjoint specs the axis map
reproduces the current result exactly (see Regression), so this is a
generalization, not a behavior change for existing cases.

### The axis map

For each axis independently, build ONE monotonic, continuous, piecewise-linear map
`f` from the in-scope specs on that axis, as an ordered list of **segments** in
ORIGINAL axis coordinates:

```
Segment = { start, end, scale, mappedStart }   // start < end, scale > 0
f(c) = mappedStart + (c - start) * scale        // for c in [start, end)
```

Invariants of a well-formed map:

- **Partition:** segments are contiguous and increasing. Coordinates below the
  first zone and above the last zone lie in implicit identity/tail segments.
- **Anchoring:** positions below all zones are unchanged — the first segment's
  `mappedStart == start`.
- **Continuity (ε = 1e-6):** each segment's `mappedStart` equals the previous
  segment's mapped end, `prev.mappedStart + (prev.end - prev.start) * prev.scale`.
- **Monotonic:** every `scale > 0`.

### Segment scales from specs

- **Leaf zone** `[near, far]`, delta `d`: one segment `[near, far]`,
  `scale = (h + d) / h`, `h = far - near`.
- **Container zone** `[near, far]`, own delta `d` (the residual), immediate sorted
  children `C1..Ck`: the interval partitions into alternating gap / child / gap
  segments. Each child `Cj` → `scale = (hj + dj) / hj` (its own delta `dj`). Each
  exclusive gap `Gp` of height `hp > TOL` → `scale = (hp + share_p) / hp`,
  `share_p = d * hp / Σ(gap heights > TOL)`. Gaps with height `≤ TOL` are dropped
  from the partition AND the denominator (no divide-by-zero).
  - Note: proportional-to-height distribution gives every gap the SAME scale
    `(ΣgapH + d) / ΣgapH` — a useful test anchor.
- **Outside all zones:** identity (scale 1). The tail above the topmost zone rides
  the total accumulated growth via `mappedStart`.

### Per-element application (NORMATIVE)

For element `E` with original axis coord `c` (from `fastPosition`), per axis:

1. `c` below the first segment → no transform on this axis.
2. Otherwise find the segment `S` containing `c`:
   - **Equipment** (non-annotation): `scale = S.scale`,
     `translate = S.mappedStart - S.start * S.scale`  (so `c ↦ f(c)`).
   - **Annotation** (`isAnnotationElement(E)`): `scale = 1`,
     `translate = S.mappedStart - S.start`  (rides the shift accumulated **below**
     `S`'s near edge; never distorts).
     - This reproduces today's rule exactly: in a lone zone `[500,600]` an in-zone
       annotation gets `translate = 0` (mappedStart 500 = start 500); a past-zone
       annotation at y=700 gets `translate = 648 - 600 = 48`. Verified against
       `svg-stretch.scoping.test.ts` (LABEL `ty == 48`).

The X and Y results compose into exactly ONE `translate(tx,ty) scale(sx,sy)` per
element (one `scale()` token — required so `checkStretchInvariants`'s single-scale
regex stays valid).

### View-region scoping under the map

A horizontal spec with `viewRegion` contributes to the X-map only for elements
whose `x ∈ [xMin, xMax]`; elements outside are identity on X. A **nested horizontal
set MUST share one viewRegion** (all present-and-equal, or all absent). A nested
horizontal set with mismatched viewRegions is treated as partial overlap (skip the
later spec + warn) — out of scope, bounded deliberately. Vertical specs are not
view-scoped (height stretches equipment in all views by design).

---

## Nesting detection (NORMATIVE classification)

For the in-scope specs on one axis, after snapping edges within `TOL`:

1. **Disjoint** if overlap `min(far) - max(near) ≤ TOL` → compose independently.
2. **Coincident** if each contains the other (both edges within `TOL`) → **merge**
   into one spec whose interval = the container's (larger) bounds and whose delta =
   the summed deltas (rare: a total and its sole component both edited; no gaps
   exist to distribute into).
3. **Nested** if exactly one contains the other:
   `A.near ≤ B.near + TOL && A.far ≥ B.far - TOL` ⇒ `A ⊇ B` (A container, B child).
4. **Partial overlap** otherwise (overlap but neither contains the other) → keep
   the earlier spec, **skip the later with a warning** (today's safe fallback). Do
   NOT compose. Not physically meaningful for engineering dimensions.

Build a **containment forest**: each spec's parent is the smallest in-scope spec
that contains it; roots and descendants form trees. Each container distributes its
residual delta across the gaps between its immediate children. **MUST** be correct
for 2-level nesting (the real case); **SHOULD** generalize to deeper nesting via
the same segment construction.

---

## The two product modes are INPUTS, not code paths

The engine is purely geometric. The **caller** (Opus-owned policy layer, out of
scope for this Fable task — stated to fix the contract boundary) chooses behavior
by which specs it passes and with what delta:

| Mode | Caller feeds the engine | Result |
|---|---|---|
| **Derive** (app default) | Leaf/component specs only. The spanning total is NOT a spec — its number is revalued by `revalueSpanningDims`, its geometry rides the map. | Components are disjoint → the axis map has no containers; existing behavior. |
| **Redistribute** | Component specs PLUS the container spec whose `delta` = **residual** = `desiredTotalDelta − Σ(childDeltas)`. | Container distributes its residual across exclusive gaps; children scale by their own deltas. |

**Contract boundary:** the engine distributes each container spec's `delta` across
that container's exclusive gaps. The caller is responsible for setting a container's
`delta` to the residual it wants absorbed. The engine does not infer intent.

---

## Rules preserved from the current engine

1. **Annotation-hold — generalized (see Per-element application).** Annotations
   never scale; they take their segment's near-edge offset. For disjoint zones this
   is identical to today (`t=0` in-zone, `t=delta` past-zone). This is a
   generalization, stated explicitly so it is not read as "byte-identical."
2. **View-region scoping** — see above.
3. **Axis independence** — vertical/horizontal compose independently.
4. **viewBox growth — derived from the maps, not a blind delta sum.** `sumV` = the
   Y-map's total growth (tail `mappedStart − start`); `sumH` = the X-map's. Apply
   `${vbX} ${vbY - sumV} ${vbW + sumH} ${vbH + sumV}` (matches current L451–453 for
   disjoint zones). Deriving from the map (not `Σ sp.delta`) keeps the viewBox
   consistent with the geometry even when a container's delta is a residual.
5. **Undo-safety** — transformed elements marked `data-stretch-transform`; revalued
   text `data-revalue-orig`; `undoStretches` restores geometry + viewBox.
6. **Safety net / invariants (`checkStretchInvariants`) unchanged** — finite
   transforms; every non-unit scale positive (no mirror) and within
   `[MIN_SANE_SCALE, MAX_SANE_SCALE]`; child count stable; viewBox non-shrink. On
   violation, self-contained `rollback()` and return `{ ok:false, reason }`.
   Watchdog (element/time budget) unchanged.
7. **Public contract unchanged** — `applyMultiStretch(svgRoot, stretches, opts)
   → StretchResult`. `StretchParams` shape unchanged (nesting inferred from
   geometry). Exactly one `scale()` token per element. No new runtime dependency.

## Suggested internal structure (isolation / testability)

Extract a pure, DOM-free unit: `buildAxisMap(specs) → Segment[]` and
`mapPoint(segments, coord) → number`, unit-testable in isolation from the SVG DOM.
`applyMultiStretch` builds the X and Y maps, then iterates elements applying the
per-element rule. Depends on existing `fastPosition`, `isAnnotationElement`,
`checkStretchInvariants`, `undoStretches`.

## Out of scope / non-goals

- Partial (non-nested) overlaps → skip-later-with-warning (today's behavior).
- Nested horizontal sets with mismatched viewRegions → treated as partial overlap.
- The switch UX and the caller-side derive/redistribute wiring — Opus follow-on.
- Arbitrary nesting depth is a SHOULD; 2-level is the gate.
- No runtime LLM; no AI-cascade changes.

---

## Acceptance criteria (harness Opus builds and owns; all offline, no creds)

**Tolerances:** scale/position assertions to ε = 1e-4; continuity to ε = 1e-6.

### Layer 1 — vitest unit tests (jsdom + synthetic fixtures, extend `fixtures.ts`)

| ID | Case | Assert (exact) |
|---|---|---|
| Disjoint | Two disjoint vertical components edited | geometrically identical to current engine within ε (NOT byte-identical — float formatting may differ). |
| D1 | Derive: silencer `+24`, no container spec | silencer scale `(96+24)/96 = 1.25`; elements above ride `+24`; no container scaling. |
| R1 | Redistribute: container `[291.5,891.5]` residual `+48`, no child edit. Exact gaps lower `239.8`, upper `264.2`, sum `504` | every gap scale `= (504+48)/504 = 1.095238`; silencer (child) scale `1`; total height `600 → 648`; map monotonic + continuous (ε 1e-6). |
| R2 | Redistribute + child: silencer `+24` AND container residual `+24` | silencer scale `1.25`; every gap scale `= (504+24)/504 = 1.047619`; elements above container shift `+48`; total `600 → 648`. |
| TopGrow | For R1 and R2 | topmost element's displacement `== sumV == 48`; viewBox top grew by exactly `48` (catches the residual/full-delta footgun). |
| AnnotGap | Annotation in a container gap | scale `1`; translate `= gap segment near-edge offset`. |
| AnnotChild | Annotation inside a CHILD zone | scale `1`; translate `= child segment near-edge offset` (never scaled inside a nested zone). |
| View | Horizontal nested pair sharing one `viewRegion` | only in-region elements transformed; companion region untouched; in-zone equipment scales. |
| Depth | 3-level nest (container ⊃ mid ⊃ leaf) | monotonic + continuous; each level's growth correct against **pre-computed pinned expected values** (do NOT re-derive expectations inside the test — a re-derivation can share a bug with the implementation). (SHOULD.) |
| ZeroGap | Child abuts container edge (lower gap height `≤ TOL`) | zero gap excluded from denominator; no divide-by-zero; remaining gap absorbs full residual. |
| Coincident | Container and sole child intervals equal within `TOL`, both with deltas | merged to one spec, delta summed; single scaled segment; no gap distribution. |
| Collapse | Residual so negative a gap would invert (scale ≤ 0) | invariant catches non-positive scale → `rollback()` → `{ ok:false }`; zero `data-stretch-transform`; viewBox restored. |
| Partial | Two partially-overlapping non-nested zones | later spec skipped with warning; former applied; `ok:true`. |

### Layer 2 — golden harness on the REAL 24081 Sheet_2 (extend `scripts/qa/`, linkedom via `~/dev/elf-lab/register.mjs`)

- **Derive golden:** silencer `+48` → overall `4000 STACK` number `50'-0" → 54'-0"`;
  silencer geometry grows; end-elevation companion dims untouched (view scoping);
  invariants pass.
- **Redistribute golden:** overall total `50'-0" → 54'-0"`, silencer unchanged →
  silencer height preserved; the two stack gaps absorb growth proportionally (equal
  gap scale); monotonic map; `sumV == 48`; invariants pass; `ok:true`.
- **Undo golden:** after either, `undoStretches` restores geometry, viewBox, and dim
  text with zero leftover markers.

### Global gates

`npm test` green (existing 75 + new), `npx tsc --noEmit` clean, eslint 0 errors on
touched files, golden harness prints ALL-PASS.

## Risks

- Proportional distribution is a chosen default; a different split is a one-line
  policy change (durable, no re-math).
- Floating-point continuity at segment joins — asserted at ε 1e-6.
- Deep nesting is a SHOULD; 2-level is the gate.
