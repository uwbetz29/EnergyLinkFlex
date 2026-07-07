# Unified 2D Scoping Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Special:** Task 5 (U2) is FARMED TO FABLE per `fable_operating_model` — Opus writes the RED harness (Tasks 3–4), farms the solve to Fable via a one-stage Workflow, then verifies. All other tasks are Opus.

**Goal:** Add cross-axis (2D) scoping to the stretch engine so a dimension edit deforms only its target component's band and holds non-target geometry (stacked neighbours, detached sub-assemblies) rigid — killing intra-view ovaling and detached-detail distortion.

**Architecture:** Extend the proven 1D segment-map engine (`axis-map.ts` / `applyMultiStretch`) with a per-zone `crossBand`; classify each element by (in-band?, position-vs-zone) per the spec's 6-row table; downstream elements ride the map's `axisGrowth` tail. Detached bodies are found by cross-axis gap detection (generalized `computeViewRegions`) and held rigid, with a WARN safety-net. Everything deterministic (no runtime LLM).

**Tech Stack:** TypeScript, Vitest (jsdom), linkedom (offline goldens), `@mlightcad/libredwg-web` SVG. Spec: `docs/superpowers/specs/2026-07-06-unified-2d-scoping-design.md` (read it first).

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `src/lib/dwg/dim-geometry.ts` | Extracted+exported `getDimBlockBounds`, `dimBlockBox2D`, `deriveComponentBoxes`, + `computeComponentBand` (U1) | **new** |
| `src/lib/dwg/detached.ts` | `detectDetachedAssemblies` (U3, gap detection) + tunables | **new** |
| `src/lib/dwg/svg-stretch.ts` | `StretchParams.crossBand`/`crossAxis`; U2 grouping + per-element classification | mod |
| `src/components/editor/svg-drawing-canvas.tsx` | import dim-geometry; wire U1/U3 into `applyAllStretches`; U4 WARN triggers | mod |
| `src/lib/dwg/__tests__/dim-geometry.test.ts` | U1 unit tests | **new** |
| `src/lib/dwg/__tests__/svg-stretch.crossband.test.ts` | U2 table rows 1–6 unit tests (the Fable RED harness). NB: named `crossband` to avoid collision with the existing 1D `svg-stretch.scoping.test.ts` | **new** |
| `src/lib/dwg/__tests__/detached.test.ts` | U3 unit tests | **new** |
| `scripts/qa/scope-golden.mjs` | G1/G2/G4 goldens on real Sheet_2/Sheet_3 | **new** |

**Conventions to follow:** `AXIS_TOL=6` for all position tolerances; `fastPosition` for element positions; classification always against ORIGINAL pre-transform coords; tests use `// @vitest-environment jsdom` like `annotations.test.ts`; offline goldens use the `~/dev/elf-lab` linkedom pattern (`register.mjs`) and the app source directly.

---

## Task 1: Extract dim-geometry into an exported module (behavior-preserving)

**Files:** Create `src/lib/dwg/dim-geometry.ts`; Modify `src/components/editor/svg-drawing-canvas.tsx` (`getDimBlockBounds` ~L938, `dimBlockBox2D` ~L986, `deriveComponentBoxes` ~L1024).

- [ ] **Step 1: Capture characterization goldens FIRST (no existing coverage).** None of the current 98 tests exercise these three closures — they are private canvas closures with zero direct coverage today, so "the app still passes" is NOT proof the refactor preserved their output. Temporarily instrument the current closures to log their return values on a fixture SVG (reuse `src/lib/dwg/__tests__/fixtures.ts`, e.g. `makeNestedStackSvg`), and record those exact values.
- [ ] **Step 2:** Read the three closures; identify every canvas-local they close over (viewBox state, `svgEl`); refactor each into a pure function taking those as explicit params.
- [ ] **Step 3:** Write `src/lib/dwg/dim-geometry.ts` exporting the three as pure functions (params in, no closure over component state).
- [ ] **Step 4:** Write `src/lib/dwg/__tests__/dim-geometry.test.ts` asserting the extracted functions return the Step-1 recorded goldens on the same fixture (this is the real behaviour-preservation check). Remove the temporary instrumentation.
- [ ] **Step 5:** In the canvas, replace the local definitions with imports from `dim-geometry.ts`; pass the previously-closed-over values as args at call sites.
- [ ] **Step 6:** Run `npx vitest run && npx tsc --noEmit && npx eslint src/lib/dwg/dim-geometry.ts src/components/editor/svg-drawing-canvas.tsx`. Expected: 98 + characterization tests pass, tsc 0, eslint 0.
- [ ] **Step 7:** Commit: `refactor(dwg): extract dim-geometry helpers + characterization tests`.

> No existing test covers these closures directly; the Step-1/4 characterization goldens ARE the behaviour-preservation check (the unrelated 98-suite is not). Task 2 adds U1 tests to the same `dim-geometry.test.ts`.

---

## Task 2: U1 — `computeComponentBand` (Opus, TDD)

**Files:** Modify `src/lib/dwg/dim-geometry.ts`; Test `src/lib/dwg/__tests__/dim-geometry.test.ts`.

- [ ] **Step 1: Write failing tests.** In `dim-geometry.test.ts` (jsdom): (a) a component with a width dim block → `computeComponentBand` returns `{aRange:[near,far]}` matching the dim's X extent and `crossBand:[cLo,cHi]` = Y extent (2D-bbox fallback); (b) a component with only a height dim, asked for a width (X) stretch → returns `null` (no A-axis zone); (c) cross-band uses on-axis measured extent, not the AI estimate. Reuse/extend `src/lib/dwg/__tests__/fixtures.ts` (`makeTwoViewSvg`/`makeNestedStackSvg` already build `*D##` `<defs>` + `*Model_Space`) rather than inlining SVG strings; add a cross-band variant (e.g. a Y-separated neighbour) if needed.
- [ ] **Step 2:** Run `npx vitest run src/lib/dwg/__tests__/dim-geometry.test.ts` — expect FAIL (`computeComponentBand` undefined).
- [ ] **Step 3: Implement** `computeComponentBand(target, svgEl): {aRange, crossBand} | null` — resolve the target's dim block ids, call `getDimBlockBounds` on the stretch axis for `aRange` (return `null` if none), and `dimBlockBox2D` for the cross-band; 2D-bbox fallback when a dim gives only one axis. Original coords.
- [ ] **Step 4:** Run tests — expect PASS. Then full `npx vitest run` — 98 + new pass.
- [ ] **Step 5:** Commit: `feat(dwg): U1 computeComponentBand from real dim geometry`.

---

## Task 3: `StretchParams`/`Spec` gain `crossBand`/`crossAxis` (Opus)

**Files:** Modify `src/lib/dwg/svg-stretch.ts` (`StretchParams` ~L50; internal spec type ~L405).

- [ ] **Step 1:** Add optional `crossBand?: { lo: number; hi: number }` and `crossAxis?: 'x' | 'y'` to `StretchParams` and thread onto the internal `rawSpecs`/`Spec` shape (both `axis:'x'` and `axis:'y'` push sites ~L412/417). Default `undefined` = today's full-band behaviour (back-compat).
- [ ] **Step 2:** Run `npx tsc --noEmit` — expect 0 (purely additive optional fields; nothing consumes them yet).
- [ ] **Step 3:** Commit: `feat(dwg): add optional crossBand/crossAxis to StretchParams`.

---

## Task 4: WRITE THE RED HARNESS for U2 (Opus owns verification)

This is the reward signal Fable iterates against. Written RED, committed, and NOT edited by Fable.

**Files:** Create `src/lib/dwg/__tests__/svg-stretch.crossband.test.ts` (jsdom).

- [ ] **Step 1: Write the U2 acceptance tests** against the public `applyMultiStretch`. Reuse/extend `src/lib/dwg/__tests__/fixtures.ts` (same fixtures `svg-stretch.scoping.test.ts`/`svg-stretch.nested.test.ts` consume) to build a Model_Space with: a target component (with `<g>`-wrapped geometry incl. a `<circle>`) in a known cross-band; a stacked neighbour circle OUTSIDE the cross-band but sharing the zone's A-range; a downstream element past `far`; an upstream element; an in-band element after `far`. Assert the 6-row table:
  - row 6: neighbour circle outside band, in/before zone → **identity** (aspect ratio unchanged; `getBBox` w/h ratio delta < 0.01).
  - row 4: in-band element in zone → scaled on A; in-band element after `far` → translated by `axisGrowth`.
  - row 5: out-of-band element after `far` → translated by the SAME `axisGrowth`, scale 1 (I2).
  - band boundary: element at `c==cLo` and `c==cHi±AXIS_TOL` classified per the half-open+tolerance rule.
  - multi-zone: two X-zones with DIFFERENT crossBands do not cross-contaminate (element in zone1 band only gets zone1 scale + zone2 translate-only).
- [ ] **Step 2: Run and confirm RED.** `npx vitest run src/lib/dwg/__tests__/svg-stretch.crossband.test.ts` — expect FAIL (crossBand not yet honored; today it scales the full band, so row-6 neighbour ovals).
- [ ] **Step 3: Commit the RED harness** (mark expected-fail in the message): `test(dwg): RED harness for U2 2D band scoping`.

> Do NOT implement U2 in this task. The RED harness is the contract handed to Fable in Task 5.

---

## Task 5: U2 — 2D band classification (**FARM TO FABLE**)

**Files:** Modify `src/lib/dwg/svg-stretch.ts` — grouping/classification (`:442-501`) AND per-element loop (`:520-547`).

**Mechanism:** a one-stage `Workflow` running `agent(packet, { model: 'fable', effort: 'medium', schema })`. The packet is self-contained: the spec §3–§4/U2, the RED harness path, exact `Spec`/`StretchParams` signatures, the anti-cheat rule, and run commands.

- [ ] **Step 1 (Opus): Assemble the Fable packet.** Include: spec §3 (6-row table + multi-stretch composition + boundary rule + I1/I2/I3), spec §4/U2 (the grouping RULE — `regionKey=(axis,viewRegion,crossBand)`; crossBand-different specs are automatically disjoint, skip the `:450-465` overlap test; each builds its own `buildAxisMap`; per-element compute cross-position, apply table, out-of-band `after` uses map tail). Exact files/line ranges. Commands: `npx vitest run src/lib/dwg/__tests__/svg-stretch.crossband.test.ts` then full `npx vitest run && npx tsc --noEmit && npx eslint <touched>`. **Anti-cheat:** Fable may NOT edit any test/fixture; green must mean the engine is right.
- [ ] **Step 2 (Fable): iterate to green** inside its own run (self-verify loop) — implement grouping + classification until the RED harness passes and the full suite + tsc + lint are clean.
- [ ] **Step 3 (Opus): verify independently.** Re-run full suite + `tsc` + `eslint`; read the diff adversarially (did it honour `axisGrowth` for row 5? does it touch grouping, not just the loop? any weakened invariant?); confirm the existing nested-zone/spatial-scoping goldens still pass. If Fable plateaued, escalate only the specific failing case to `effort:'high'`.
- [ ] **Step 4 (Opus): Commit** the accepted U2: `feat(dwg): U2 2D band classification (Fable-built, Opus-verified)`.

---

## Task 6: U3 — `detectDetachedAssemblies` gap detection (Opus, TDD)

**Files:** Create `src/lib/dwg/detached.ts`; Test `src/lib/dwg/__tests__/detached.test.ts`.

- [ ] **Step 1: Write failing tests.** (a) synthetic Model_Space with a compact cluster separated from the main mass by a near-empty corridor on Y (a few "pipe" elements crossing) → returns one candidate with bbox ≈ the cluster and `confidence ≥ CONF_MIN`; (b) same but corridor half-filled → `confidence < CONF_MIN`; (c) no gap → returns `[]`. Deterministic (assert exact bbox + confidence bucket).
- [ ] **Step 2:** Run — expect FAIL (`detectDetachedAssemblies` undefined).
- [ ] **Step 3: Implement** per spec §4/U3: bin `fastPosition` points (annotations excluded) per axis; find corridors where slice density `< EMPTY_FRAC × median_slice_density` (`EMPTY_FRAC=0.05`); a compact cluster across a corridor of width `≥ MIN_CORRIDOR_WIDTH` from the main mass is a candidate; `confidence = clamp(min(median_density/max(corridor_density,ε), corridor_width/MIN_CORRIDOR_WIDTH) normalized to [0,1])`; `CONF_MIN=0.6`. Deterministic ties by coordinate order. Original coords.
- [ ] **Step 4:** Run tests — PASS. Full `npx vitest run` green.
- [ ] **Step 5:** Commit: `feat(dwg): U3 detached-assembly gap detection`.

> Method note: despite the spec's "generalizes `computeViewRegions`" framing (which uses sorted-gap-median on 1D), U3's actual method is **binned-density corridor detection** (validated offline in `~/dev/elf-lab/spike2-detect.mjs`) — a NEW implementation, not a refactor of `view-model.ts`. Don't reach for the `computeViewRegions` code shape.

---

## Task 7: U4 WARN + wire U1/U3 into the stretch path (Opus)

**Files:** Modify `src/components/editor/svg-drawing-canvas.tsx` (`applyAllStretches`, the `applyMultiStretch` call ~L1242); possibly `src/lib/dwg/svg-stretch.ts` for the detached-body param.

- [ ] **Step 1: Write failing tests** (store/canvas-level or a focused unit): (a) a stretch whose zone straddles a low-confidence detached candidate → `setStretchWarning("Detached details present — review manually")` fired, zero blob elements scaled; (b) a high-confidence detached body inside an actively-scaling band → WARN fired (§7 U4b). Assert on the store warning + a scale-count probe.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3: Implement:** in `applyAllStretches`, call `computeComponentBand` per edited component and `detectDetachedAssemblies(modelSpace)` (cache per SVG load), pass `crossBand` per zone + detached bboxes into `applyMultiStretch`; apply the §3 detached rows + the U4 WARN triggers via `setStretchWarning`. Keep `MAX_STRETCH_RATIO` global.
- [ ] **Step 4:** Run tests — PASS. Full suite green + tsc + lint.
- [ ] **Step 5:** Commit: `feat(editor): wire 2D scoping + detached WARN into stretch path`.

---

## Task 8: Real-drawing goldens (Opus verification, offline)

**Files:** Create `scripts/qa/scope-golden.mjs` (linkedom, real Sheet_2/Sheet_3 from `~/dev/elf-lab`). Imports: `applyMultiStretch` from `svg-stretch.ts`, `axisGrowth`/`buildAxisMap` from `axis-map.ts` (needed for the "translated by `axisGrowth`" assertion), `isAnnotationElement` from `annotations.ts`; follow the existing `nested-zone-golden.mjs`/`spatial-scoping-golden.mjs` pattern.

- [ ] **Step 1: G1 (Sheet_2):** apply a width edit on a mid component via the public engine; assert neighbour circle aspect-ratio drift < 1%, target dim correct, every `after` element translated by `axisGrowth` within `AXIS_TOL`, both elevations co-stretch.
- [ ] **Step 2: G2 (Sheet_3):** horizontal duct stretch crossing the skid; assert skid pump circles aspect-ratio drift < 1% (held by U2 Y-separation), main duct stretches, skid dim unchanged.
- [ ] **Step 3: G4 (shrink):** negative-delta edit → in-band shrinks, neighbours unchanged; below `1/MAX_STRETCH_RATIO` rolls back with the generic warning.
- [ ] **Step 4: Run** `node --import ~/dev/elf-lab/register.mjs scripts/qa/scope-golden.mjs` — expect all assertions pass. Also confirm `detectDetachedAssemblies` on real Sheet_3 returns the skid at Y≈[812,849] with `confidence ≥ CONF_MIN` (G3).
- [ ] **Step 5:** Commit: `test(qa): real-drawing goldens for 2D scoping (G1–G4)`.

---

## Final verification (before declaring done)

- [ ] `npx vitest run` — all green (98 + new).
- [ ] `npx tsc --noEmit` — exit 0.
- [ ] `npx eslint <all touched>` — 0 errors.
- [ ] `node --import ~/dev/elf-lab/register.mjs scripts/qa/scope-golden.mjs` — G1–G4 pass; plus existing `nested-zone-golden.mjs` + `spatial-scoping-golden.mjs` still pass.
- [ ] Adversarial diff read of U2 (Fable output) + U3.
- [ ] Live browser pass on :3002 (re-add dev-login, revert before commit): a width edit on a Sheet_2 stacked component → neighbours don't oval; confirm no regressions to bug #1/#2/#3.
- [ ] Update memory: mark Unified 2D Scoping DONE in `package_b_parked` / `project_status`.
