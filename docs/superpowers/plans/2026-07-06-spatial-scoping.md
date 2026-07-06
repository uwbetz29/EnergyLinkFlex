# Spatial Scoping for the DWG Stretch Engine, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the DWG stretch engine per-view so a height change no longer distorts companion-elevation annotations and a width change no longer slides the companion elevation, and make it fail safe so a corrupted drawing is never shown to a customer.

**Architecture:** Axis-differentiated scoping. Height stretches keep global equipment scaling (both elevations share the datum) but make annotations translate-only. Width stretches are scoped to the edited view via a deterministically-derived view model (X-gutter split). A runtime watchdog (element/time budget) plus post-stretch invariant checks with automatic rollback guarantee the drawing is either correctly stretched or left in its prior known-good state, never corrupt.

**Tech Stack:** TypeScript, Next.js, vitest + jsdom (unit tests), the existing element-level SVG stretch in `src/lib/dwg/svg-stretch.ts`.

**Spec:** `docs/superpowers/specs/2026-07-06-spatial-scoping-design.md`

---

## Commercial-stakes guardrails (read first)

This is customer-facing output for multimillion-dollar bids. Two rules govern the whole plan:

1. **Never render a wrong drawing.** Every stretch pass must end in one of two states: (a) correctly stretched and passing all invariants, or (b) rolled back to the prior known-good geometry with a surfaced warning. There is no third state. The watchdog + invariant checks in Task 5 enforce this.
2. **Never worse than today.** Every new code path has a fail-safe fallback to current behavior (single view region, equipment-default classification). If the view model or classifier is uncertain, degrade to what ships today, which is already validated for the near elevation.

**Commit policy (overrides the skill's "frequent commits"):** Mike commits only when he asks. Each task below lists a commit step; the executor must **stop and request approval** at that step instead of auto-committing, and must **revert the `src/auth.ts` dev-login shortcut + `DEV_LOGIN_EMAIL` in `.env.local` before any commit** (see Task 8). Treat the commit steps as checkpoints.

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/lib/dwg/annotations.ts` | Create | Single source of truth: annotation block-name predicate + `isAnnotationElement`. Shared by the render strip and the stretch classifier. |
| `src/lib/dwg/view-model.ts` | Create | Deterministic view-region partition (`computeViewRegions`, `viewOf`, `ViewRegion`). |
| `src/lib/dwg/svg-stretch.ts` | Modify | `StretchParams.viewRegion`; axis-differentiated + annotation-aware rules in `applyMultiStretch`; watchdog + invariant checks + rollback; return a `StretchResult`. Export `findModelSpace` (already exported) and `fastPosition` (already exported). |
| `src/components/editor/svg-drawing-canvas.tsx` | Modify | `postProcessSvgDom` reuses the shared predicate; `applyAllStretches` computes view regions, tags width stretches, and handles a failed `StretchResult` (surface warning, leave drawing unchanged). |
| `src/lib/dwg/__tests__/annotations.test.ts` | Create | Unit tests for the classifier. |
| `src/lib/dwg/__tests__/view-model.test.ts` | Create | Unit tests for view regions + `viewOf`. |
| `src/lib/dwg/__tests__/svg-stretch.scoping.test.ts` | Create | Unit tests for scoped rules + watchdog + invariant rollback. |
| `scripts/qa/spatial-scoping-golden.mjs` | Create | Offline golden verification against the real customer SVG (NOT committed data; run from `~/dev/elf-lab`). |
| `docs/superpowers/plans/2026-07-06-spatial-scoping-QA.md` | Create | Manual browser QA checklist for when the app + AI creds are available. |

**Test environment:** the DOM tests need jsdom. Put `// @vitest-environment jsdom` at the top of each test file that parses SVG. Build SVG via `new DOMParser().parseFromString(str, "image/svg+xml")`. Use **small synthetic fixtures** (a two-view SVG with a gutter and a handful of elements), never the 44 MB customer SVG, which stays out of the repo and is exercised only by the offline golden harness (Task 7).

**Shared test fixture:** define once and reuse. A helper `makeTwoViewSvg()` returning an SVG string with:
- viewBox `0 -1000 2000 1000`, a `<g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">` wrapper.
- View 0 equipment: several `<line>` at x in `[100, 300]`, y spanning a stack including a silencer band `y=[500,600]`.
- Gutter: no equipment in x `[400, 1400]`.
- View 1 equipment: several `<line>` at x in `[1500, 1700]`, same y bands (datum-aligned).
- Annotations: a dim `<use href="#*D1">` (silencer, anchor in view 0), a dim `<use href="#*D2">` (a companion dim in view 1 whose anchor is BELOW the silencer band), a `<text>`, a `<use href="#CENTER LINE">`, a `<use href="#Borders ELC-D">`.
- `<defs>` with `<g id="*D1">`/`<g id="*D2">` each containing a value `<text>` and `<line>` witness lines.

---

## Task 1: Shared annotation predicate

**Files:**
- Create: `src/lib/dwg/annotations.ts`
- Test: `src/lib/dwg/__tests__/annotations.test.ts`
- Modify (later, Task 6): `src/components/editor/svg-drawing-canvas.tsx` reuses this.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isAnnotationBlockName, isAnnotationElement } from "../annotations";

const el = (svg: string) =>
  new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, "image/svg+xml"
  ).documentElement.firstElementChild as Element;

describe("annotation predicate", () => {
  it("recognizes annotation block names (render-strip parity)", () => {
    for (const n of ["CriticalFeature", "Borders ELC-D", "Title Blocks ELC-GA",
      "THIRD ANGLE PROJECTION", "2dTransSection0", "Datum Identifier1", "Datum Identifier7"])
      expect(isAnnotationBlockName(n)).toBe(true);
    expect(isAnnotationBlockName("#CriticalFeature")).toBe(true); // tolerates leading #
  });
  it("does NOT treat equipment or bare geometry as annotation block names", () => {
    expect(isAnnotationBlockName("SomeEquipmentBlock")).toBe(false);
  });
  it("classifies elements: dims, text, centerlines, symbols = annotation", () => {
    expect(isAnnotationElement(el(`<use href="#*D23"/>`))).toBe(true);
    expect(isAnnotationElement(el(`<g><use href="#*D23"/></g>`))).toBe(true);
    expect(isAnnotationElement(el(`<text x="1" y="2">50'-0"</text>`))).toBe(true);
    expect(isAnnotationElement(el(`<use href="#CENTER LINE_3"/>`))).toBe(true);
    expect(isAnnotationElement(el(`<use href="#Borders ELC-D"/>`))).toBe(true);
  });
  it("classifies raw geometry as equipment (not annotation)", () => {
    expect(isAnnotationElement(el(`<line x1="0" y1="0" x2="9" y2="9"/>`))).toBe(false);
    expect(isAnnotationElement(el(`<g><path d="M0 0 L9 9"/></g>`))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- annotations`
Expected: FAIL, module `../annotations` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/dwg/annotations.ts
/**
 * Single source of truth for "which DWG blocks are annotation clutter vs equipment".
 * Consumed by the render strip (postProcessSvgDom) AND the stretch classifier, so the
 * two never drift. A block referenced by <use href="#name"> is annotation when it is a
 * dimension, border, title block, datum, section-cut marker, projection symbol, or a
 * named callout (center line, critical feature).
 */

/** Exact annotation block names (the render-strip set). */
export const ANNOTATION_BLOCK_NAMES = new Set<string>([
  "CriticalFeature",
  "Datum Identifier1",
  "DatumFilled45",
  "Filled-1",
  "_Closed",
  "Perf Puddle",
  "DESIGN STATE",
  "PRELIMINARY ISSUE",
]);

/** True when a <use> block name (with or without leading '#') is annotation clutter. */
export function isAnnotationBlockName(href: string): boolean {
  const name = href.replace(/^#/, "");
  return (
    ANNOTATION_BLOCK_NAMES.has(name) ||
    name.includes("Border") ||
    name.includes("Title Block") ||
    name.includes("PROJECTION") ||
    name.includes("2dTransSection") ||
    name.startsWith("Datum Identifier")
  );
}

/**
 * True when a Model_Space child is an annotation (dimension, text, callout, symbol)
 * rather than equipment geometry. Equipment = raw geometry not wrapped in a named
 * annotation <use>. Note: unlike the render strip (which KEEPS "CENTER LINE" callouts
 * visible), the stretch classifier treats CENTER LINE as annotation so its label
 * translates rigidly instead of scaling.
 */
export function isAnnotationElement(el: Element): boolean {
  if (el.tagName === "text") return true;
  const useEl = el.tagName === "use" ? el : el.querySelector?.("use") ?? null;
  const href =
    useEl?.getAttribute("href") || useEl?.getAttribute("xlink:href") || "";
  if (!href) return false;
  if (/#?\*D\d+$/.test(href)) return true;             // dimension block
  if (href.replace(/^#/, "").startsWith("CENTER LINE")) return true; // component callout
  return isAnnotationBlockName(href);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- annotations`
Expected: PASS (all cases).

- [ ] **Step 5: Checkpoint (request commit approval)**

Proposed message: `refactor(dwg): extract shared annotation predicate`
Do not commit without Mike's approval.

---

## Task 2: View model

**Files:**
- Create: `src/lib/dwg/view-model.ts`
- Test: `src/lib/dwg/__tests__/view-model.test.ts`

- [ ] **Step 1: Write the failing test** (uses `makeTwoViewSvg()` fixture + `findModelSpace`)

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeViewRegions, viewOf } from "../view-model";
import { findModelSpace } from "../svg-stretch";
import { makeTwoViewSvg } from "./fixtures";

const ms = (svgStr: string) =>
  findModelSpace(
    new DOMParser().parseFromString(svgStr, "image/svg+xml").documentElement as any
  )!;

describe("view model", () => {
  it("splits a two-elevation drawing into 2 regions at the gutter", () => {
    const regions = computeViewRegions(ms(makeTwoViewSvg()));
    expect(regions.length).toBe(2);
    expect(regions[0].xMax).toBeLessThan(400);   // view 0 ends before the gutter
    expect(regions[1].xMin).toBeGreaterThan(1400); // view 1 starts after the gutter
  });
  it("returns a single region when there is no clear gutter (global fallback)", () => {
    // one dense equipment cluster (no gutter): X spans [100, 305], all gaps < threshold
    const eq = (x: number, y: number) => `<line x1="${x}" y1="${y}" x2="${x + 5}" y2="${y + 5}"/>`;
    const body = [100, 150, 200, 250, 300].flatMap((x) => [400, 500, 600, 700].map((y) => eq(x, y))).join("");
    const svg = `<svg viewBox="0 -1000 2000 1000" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">${body}</g></g></svg>`;
    expect(computeViewRegions(ms(svg)).length).toBe(1);
  });
  it("returns [] when there is too little equipment to cluster", () => {
    const bare = `<svg viewBox="0 -10 10 10" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space"></g></g></svg>`;
    expect(computeViewRegions(ms(bare))).toEqual([]);
  });
  it("viewOf maps positions to regions; gutter ties resolve left", () => {
    const regions = [{ xMin: 100, xMax: 300 }, { xMin: 1500, xMax: 1700 }];
    expect(viewOf(200, regions)).toBe(regions[0]);
    expect(viewOf(1600, regions)).toBe(regions[1]);
    expect(viewOf(900, regions)).toBe(regions[0]); // equidistant midpoint -> left
    expect(viewOf(0, [])).toBeNull();               // no regions -> global fallback
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- view-model`
Expected: FAIL, module `../view-model` (and `./fixtures`) not found.

- [ ] **Step 3: Create the fixture helper**

```ts
// src/lib/dwg/__tests__/fixtures.ts
/** Small two-elevation SVG mirroring the LibreDWG structure (datum-aligned views,
 *  a clean X-gutter, plus annotations). Used across view-model and scoping tests. */
export function makeTwoViewSvg(): string {
  const eq = (x: number, y: number) => `<line x1="${x}" y1="${y}" x2="${x + 5}" y2="${y + 5}"/>`;
  const view0 = [100, 150, 200, 250, 300].flatMap((x) => [400, 500, 550, 600, 700].map((y) => eq(x, y))).join("");
  const view1 = [1500, 1550, 1600, 1650, 1700].flatMap((x) => [400, 500, 550, 600, 700].map((y) => eq(x, y))).join("");
  const dimUse = (id: string, x: number, y: number) => `<use href="#${id}" x="${x}" y="${y}"/>`;
  return `<svg viewBox="0 -1000 2000 1000" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <g id="*D1"><text x="80" y="550">8'-0"</text><line x1="80" y1="500" x2="80" y2="600"/></g>
      <g id="*D2"><text x="1480" y="419">21'-3"</text><line x1="1480" y1="291" x2="1480" y2="546"/></g>
      <g id="*D3"><text x="60" y="591">50'-0"</text><line x1="60" y1="291" x2="60" y2="891"/></g>
    </defs>
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${view0}${view1}
      ${dimUse("*D1", 80, 550)}${dimUse("*D2", 1480, 419)}${dimUse("*D3", 60, 591)}
      <text x="200" y="700">LABEL</text>
      <use href="#CENTER LINE" x="150" y="650"/>
      <use href="#Borders ELC-D" x="1000" y="500"/>
    </g></g></svg>`;
}
```

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/dwg/view-model.ts
import { fastPosition } from "./svg-stretch";
import { isAnnotationElement } from "./annotations";

export interface ViewRegion {
  xMin: number;
  xMax: number;
}

/** A gutter must exceed this multiple of the median inter-sample X-gap to split views. */
const GUTTER_FACTOR = 20;
/** ...and be at least this many drawing units wide (units are inches; 1 unit = 1 inch). */
const MIN_GUTTER_UNITS = 100;

/**
 * Partition Model_Space into side-by-side view regions by detecting the large X-gutter
 * between elevations. Uses ONLY equipment X-positions (annotations excluded, so their
 * scattered placement does not blur the split). Returns [] when there is too little
 * geometry to cluster, and a single region when there is no clear gutter — both cases
 * make the caller fall back to today's global behavior.
 */
export function computeViewRegions(modelSpace: Element): ViewRegion[] {
  const xs: number[] = [];
  for (const child of Array.from(modelSpace.children)) {
    if (isAnnotationElement(child)) continue;
    const p = fastPosition(child);
    if (p && Number.isFinite(p.x)) xs.push(p.x);
  }
  if (xs.length < 2) return [];
  xs.sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;
  const threshold = Math.max(MIN_GUTTER_UNITS, median * GUTTER_FACTOR);

  const regions: ViewRegion[] = [];
  let start = xs[0];
  let prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - prev > threshold) {
      regions.push({ xMin: start, xMax: prev });
      start = xs[i];
    }
    prev = xs[i];
  }
  regions.push({ xMin: start, xMax: prev });
  return regions;
}

/**
 * Map an X position to its view region. If X lands inside a region, return it; if it
 * falls in a gutter, return the nearest region (ties resolve to the LEFT region for
 * determinism). Returns null when there are no regions, so the caller uses global scope.
 */
export function viewOf(x: number, regions: ViewRegion[]): ViewRegion | null {
  if (regions.length === 0) return null;
  for (const r of regions) if (x >= r.xMin && x <= r.xMax) return r;
  let best = regions[0];
  let bestDist = Infinity;
  for (const r of regions) {
    const dist = x < r.xMin ? r.xMin - x : x - r.xMax;
    if (dist < bestDist) {
      bestDist = dist; // strict '<' keeps the left-most region on ties (regions are x-sorted)
      best = r;
    }
  }
  return best;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- view-model`
Expected: PASS.

- [ ] **Step 6: Checkpoint (request commit approval)**

Proposed message: `feat(dwg): deterministic view-region model`

---

## Task 3: Scoped + annotation-aware stretch rules

**Files:**
- Modify: `src/lib/dwg/svg-stretch.ts` (the `StretchParams` interface and `applyMultiStretch`)
- Test: `src/lib/dwg/__tests__/svg-stretch.scoping.test.ts`

- [ ] **Step 1: Write the failing test** (behavior only; safeguards come in Task 5)

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { applyMultiStretch, findModelSpace, fastPosition } from "../svg-stretch";
import { isAnnotationElement } from "../annotations";
import { makeTwoViewSvg } from "./fixtures";

const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml").documentElement as any;
const tf = (el: Element) => el.getAttribute("transform") || "";
const hasScale = (t: string) => /scale\((?!1,\s*1\))/.test(t);

// vertical stretch of the silencer band y=[500,600], +48 units, full width (height = global)
const heightSpec = { componentId: "sil", direction: "vertical", delta: 48,
  svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as const;

describe("scoped stretch rules", () => {
  it("HEIGHT: annotations never scale; equipment scales in BOTH views", () => {
    const svg = parse(makeTwoViewSvg());
    applyMultiStretch(svg, [heightSpec as any]);
    const kids = Array.from(findModelSpace(svg)!.children);
    for (const k of kids) {
      const p = fastPosition(k); if (!p) continue;
      if (isAnnotationElement(k)) {
        expect(hasScale(tf(k))).toBe(false); // annotation: translate-only, never distorted
      }
    }
    // equipment in-zone in view 0 AND view 1 got scaled (both elevations grow)
    const scaledXs = kids.filter((k) => hasScale(tf(k)))
      .map((k) => fastPosition(k)?.x ?? -1);
    expect(scaledXs.some((x) => x < 400)).toBe(true);   // view 0 equipment scaled
    expect(scaledXs.some((x) => x > 1400)).toBe(true);  // view 1 equipment scaled
  });

  it("WIDTH: a view-scoped horizontal stretch leaves the other view untouched", () => {
    const svg = parse(makeTwoViewSvg());
    // widen something in view 0 only: horizontal zone x=[150,250], scoped to view 0
    const widthSpec = { componentId: "duct", direction: "horizontal", delta: 24,
      svgBounds: { top: -1000, bottom: 0, left: 150, right: 250 },
      viewRegion: { xMin: 100, xMax: 300 } } as const;
    applyMultiStretch(svg, [widthSpec as any]);
    const kids = Array.from(findModelSpace(svg)!.children);
    for (const k of kids) {
      const p = fastPosition(k); if (!p) continue;
      if (p.x > 1400) expect(tf(k)).toBe(""); // view 1 completely untouched
    }
    // view 0 to the right of the zone shifted, in-zone equipment scaled
    expect(kids.some((k) => (fastPosition(k)?.x ?? 0) < 400 && tf(k) !== "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoping`
Expected: FAIL (annotations currently scale in-zone; `viewRegion` ignored).

- [ ] **Step 3: Implement the scoped rules in `applyMultiStretch`**

In `src/lib/dwg/svg-stretch.ts`:

1. Add `viewRegion` to `StretchParams`:

```ts
export interface StretchParams {
  componentId: string;
  svgBounds: { top: number; bottom: number; left: number; right: number };
  direction: "vertical" | "horizontal";
  delta: number;
  /** Width stretches only: confine the stretch to this X-interval (the edited view). */
  viewRegion?: { xMin: number; xMax: number };
}
```

2. Carry `viewRegion` into the internal `Spec` type and each `specs.push(...)`:

```ts
type Spec = { axis: "x" | "y"; near: number; far: number; scale: number; delta: number;
              viewRegion?: { xMin: number; xMax: number } };
// ...vertical branch:
specs.push({ axis: "y", near, far, scale: (h + s.delta) / h, delta: s.delta, viewRegion: s.viewRegion });
// ...horizontal branch:
specs.push({ axis: "x", near, far, scale: (w + s.delta) / w, delta: s.delta, viewRegion: s.viewRegion });
```

3. Import the classifier at the top: `import { isAnnotationElement } from "./annotations";`

4. In the per-child loop, compute the annotation flag once and apply the scoped, annotation-aware rule:

```ts
for (const child of children) {
  const pos = fastPosition(child);
  if (!pos) continue;
  const annotation = isAnnotationElement(child);

  let sx = 1, sy = 1, tx = 0, ty = 0;
  for (const sp of kept) {
    // Width scoping: skip elements outside the edited view.
    if (sp.viewRegion && (pos.x < sp.viewRegion.xMin || pos.x > sp.viewRegion.xMax)) continue;

    const c = sp.axis === "y" ? pos.y : pos.x;
    let t = 0, sc = 1;
    if (c > sp.far) {
      t = sp.delta;                         // past the zone: rigid shift (all element kinds)
    } else if (c >= sp.near) {
      if (annotation) {
        t = 0;                              // in-zone annotation: hold position, NEVER scale
      } else {
        sc = sp.scale;                      // in-zone equipment: scale about the near edge
        t = sp.near * (1 - sp.scale);
      }
    } else {
      continue;                             // before the zone: untouched
    }
    if (sp.axis === "y") { sy *= sc; ty += t; }
    else { sx *= sc; tx += t; }
  }

  if (sx !== 1 || sy !== 1 || tx !== 0 || ty !== 0) {
    child.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
    child.setAttribute("data-stretch-transform", "true");
    transformed++;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoping`
Expected: PASS.

- [ ] **Step 5: Regression check** — the existing multi-stretch behavior must be unchanged for the non-scoped, equipment case.

Run: `npm test -- svg-stretch`
Expected: PASS (any existing stretch tests still green). If none exist, add one asserting a single vertical equipment stretch on the fixture matches the pre-change transform values.

- [ ] **Step 6: Checkpoint (request commit approval)**

Proposed message: `feat(dwg): axis-differentiated, view-scoped stretch rules`

---

## Task 4: Wire view regions into the canvas

**Files:**
- Modify: `src/components/editor/svg-drawing-canvas.tsx`
  - `applyAllStretches`: compute regions once, tag width stretches.
  - `postProcessSvgDom`: reuse `isAnnotationBlockName` (remove the duplicated inline checks).

- [ ] **Step 1: Refactor `postProcessSvgDom` to the shared predicate**

Replace the inline `ANNOTATION_BLOCKS.has(href) || href.includes("Border") || ...` condition with:

```ts
import { isAnnotationBlockName } from "@/lib/dwg/annotations";
// ...
svgRoot.querySelectorAll("use").forEach((use) => {
  const href = (use.getAttribute("href") || "").replace("#", "");
  if (isAnnotationBlockName(href)) {
    const parent = use.parentElement;
    if (parent) parent.style.display = "none";
  }
});
```

Delete the now-duplicated `ANNOTATION_BLOCKS` set from the canvas (it moved to `annotations.ts`), leaving `HIDDEN_LAYERS` intact. `CENTER LINE` and `*D##` remain visible because `isAnnotationBlockName` returns false for them (verified by the Task 1 tests) — render behavior is unchanged.

- [ ] **Step 2: Compute regions and tag width stretches in `applyAllStretches`**

After `const vbAttr = ...` is parsed and before the queue loop, add:

```ts
import { computeViewRegions, viewOf } from "@/lib/dwg/view-model";
import { findModelSpace } from "@/lib/dwg/svg-stretch";
// ...
const modelSpace = findModelSpace(svgEl);
const viewRegions = modelSpace ? computeViewRegions(modelSpace) : [];
```

In the queue loop, when building a horizontal stretch, attach the edited dim's view:

```ts
let viewRegion: { xMin: number; xMax: number } | undefined;
if (dir === "horizontal" && viewRegions.length > 1) {
  const dimX = (dimBounds.min + dimBounds.max) / 2; // width dim: bounds are X
  viewRegion = viewOf(dimX, viewRegions) ?? undefined;
}
stretches.push({ componentId: compId, svgBounds, direction: dir, delta, viewRegion });
```

(Vertical stretches leave `viewRegion` undefined, i.e. global — the datum-aligned behavior we want.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Checkpoint (request commit approval)**

Proposed message: `feat(canvas): scope width stretches to the edited view`

---

## Task 5: Watchdog, invariants, and rollback (the safety net)

This is the commercial-stakes core: the stretch must never leave a corrupt drawing on screen.

**Files:**
- Modify: `src/lib/dwg/svg-stretch.ts` (`applyMultiStretch` returns `StretchResult`; add budget + invariants + rollback)
- Modify: `src/components/editor/svg-drawing-canvas.tsx` (`applyAllStretches` handles a failed result)
- Test: `src/lib/dwg/__tests__/svg-stretch.scoping.test.ts` (add safety cases)

- [ ] **Step 1: Write the failing safety tests**

```ts
import { applyMultiStretch, findModelSpace } from "../svg-stretch";
import { makeTwoViewSvg } from "./fixtures";
const parse = (s: string) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement as any;

describe("stretch safeguards", () => {
  it("returns ok:true and a transformed count on a normal stretch", () => {
    const svg = parse(makeTwoViewSvg());
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 48,
      svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as any]);
    expect(r.ok).toBe(true);
    expect(r.transformed).toBeGreaterThan(0);
  });

  it("WATCHDOG: aborts and rolls back when the element budget is exceeded", () => {
    const svg = parse(makeTwoViewSvg());
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 48,
      svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as any], { maxElements: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/budget|elements/i);
    // rolled back: no stretch transforms remain
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
  });

  it("INVARIANT: aborts and rolls back a wild scale factor", () => {
    const svg = parse(makeTwoViewSvg());
    // zone height 1 with delta 1000 -> scale ~1001, far outside the sane bound
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 1000,
      svgBounds: { top: -501, bottom: -500, left: 0, right: 2000 } } as any]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scale|invariant/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
    // viewBox restored by applyMultiStretch's self-contained rollback (does NOT require
    // the caller to have run saveOriginalViewBox — the safety net stands on its own)
    expect(svg.getAttribute("viewBox")).toBe("0 -1000 2000 1000");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- scoping`
Expected: FAIL (`applyMultiStretch` returns void; no budget/invariant handling).

- [ ] **Step 3: Implement `StretchResult`, watchdog, invariants, rollback**

```ts
export interface StretchResult {
  ok: boolean;
  reason?: string;
  transformed: number;
}

/** Safety budgets. The real drawing is ~75k elements and a stretch runs in ~1-2s. */
const DEFAULT_MAX_ELEMENTS = 200_000;
const DEFAULT_MAX_MS = 4_000;
const MIN_SANE_SCALE = 0.02;
const MAX_SANE_SCALE = 50;

export function applyMultiStretch(
  svgRoot: SVGSVGElement,
  stretches: StretchParams[],
  opts: { maxElements?: number; maxMs?: number } = {}
): StretchResult {
  const maxElements = opts.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;

  const active = stretches.filter((s) => Math.abs(s.delta) >= 0.01);
  if (active.length === 0) return { ok: true, transformed: 0 };

  const modelSpace = findModelSpace(svgRoot);
  if (!modelSpace) { console.warn("[ELF stretch] no *Model_Space"); return { ok: false, reason: "no model space", transformed: 0 }; }

  const vbStr = svgRoot.getAttribute("viewBox");
  const vb = vbStr?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n)))
    return { ok: false, reason: "bad viewBox", transformed: 0 };
  const [vbX, vbY, vbW, vbH] = vb;

  // ...existing spec normalization + overlap guard (kept[]) unchanged...

  const children = Array.from(modelSpace.children) as SVGGElement[];

  // WATCHDOG (pre): element budget.
  if (children.length > maxElements)
    return { ok: false, reason: `element budget exceeded (${children.length} > ${maxElements})`, transformed: 0 };

  // Self-contained rollback: restore geometry AND the original viewBox string. The
  // safety net must NOT depend on the caller having called saveOriginalViewBox, so we
  // restore the viewBox from the `vbStr` captured at entry rather than relying on
  // undoStretches' data-original-viewbox path.
  const rollback = () => {
    undoStretches(svgRoot);
    if (vbStr) svgRoot.setAttribute("viewBox", vbStr);
  };

  const t0 = performance.now();
  let transformed = 0;

  // NOTE: this indexed loop SUPERSEDES the `for (const child of children)` header from
  // Task 3 (the index is needed for the watchdog time-check). The per-child body is
  // exactly Task 3's scoped/annotation-aware logic, unchanged.
  for (let i = 0; i < children.length; i++) {
    // WATCHDOG (mid): time budget.
    if ((i & 8191) === 0 && performance.now() - t0 > maxMs) {
      rollback();
      return { ok: false, reason: `watchdog timeout after ${Math.round(performance.now() - t0)}ms`, transformed: 0 };
    }
    const child = children[i];
    // ...existing per-child scoped/annotation-aware transform logic from Task 3...
  }

  svgRoot.setAttribute("viewBox", `${vbX} ${vbY - sumV} ${vbW + sumH} ${vbH + sumV}`);

  // INVARIANTS (post): if anything is off, roll back to the prior known-good geometry.
  const invariantError = checkStretchInvariants(svgRoot, modelSpace, children.length, vb);
  if (invariantError) {
    rollback();
    return { ok: false, reason: invariantError, transformed: 0 };
  }

  return { ok: true, transformed };
}

/** Returns an error string if any post-stretch invariant is violated, else null. */
function checkStretchInvariants(
  svgRoot: SVGSVGElement,
  modelSpace: Element,
  originalChildCount: number,
  origVb: number[]
): string | null {
  // 1. child count unchanged (nothing dropped)
  if (modelSpace.children.length !== originalChildCount)
    return `child count changed (${originalChildCount} -> ${modelSpace.children.length})`;

  // 2. every applied transform is finite and scales are sane
  const transformed = modelSpace.querySelectorAll("[data-stretch-transform]");
  for (const el of transformed) {
    const t = el.getAttribute("transform") || "";
    const tr = t.match(/translate\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
    const sc = t.match(/scale\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
    const nums = [tr?.[1], tr?.[2], sc?.[1], sc?.[2]].filter((v) => v != null).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return "non-finite transform value";
    if (sc) {
      for (const s of [+sc[1], +sc[2]]) {
        if (s === 1) continue;
        // A non-positive scale mirrors/collapses the geometry (visually corrupt) and is
        // NOT caught by the area check when a concurrent grow on the other axis dominates.
        if (s <= 0) return `non-positive (mirrored) scale (${s})`;
        if (s < MIN_SANE_SCALE || s > MAX_SANE_SCALE) return `scale out of bounds (${s})`;
      }
    }
  }

  // 3. viewBox finite and did not shrink
  const vb = svgRoot.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return "viewBox became non-finite";
  if (vb[2] * vb[3] < origVb[2] * origVb[3] - 1e-6) return "viewBox area shrank";

  return null;
}
```

- [ ] **Step 4: Handle the result in `applyAllStretches`** (`svg-drawing-canvas.tsx`)

```ts
const result = applyMultiStretch(svgEl, stretches);
if (!result.ok) {
  console.error(`[ELF stretch] aborted (${result.reason}); drawing left unchanged`);
  undoStretches(svgEl);         // belt-and-suspenders: guarantee known-good geometry
  postProcessSvgDom(svgEl);
  svgEl.style.visibility = "";
  notifyStretchFailed(result.reason); // surface a non-blocking warning to the user (see Step 5)
  return;                        // do NOT re-value dims off a rolled-back geometry
}
revalueSpanningDims(svgEl, stretches, editedBlockIds);
```

- [ ] **Step 5: Surface a user-visible warning**

The editor store has NO messaging/toast state today (verified against `editor-store.ts`), so add a minimal one rather than hunting for an action to reuse:

1. In `src/stores/editor-store.ts`, add to the `EditorState` interface: `stretchWarning: string | null;` and the action signature `setStretchWarning: (msg: string | null) => void;`. Initialize `stretchWarning: null` in the store defaults, and implement `setStretchWarning: (msg) => set({ stretchWarning: msg })` in the actions block.
2. Add a `notifyStretchFailed(reason: string)` helper in the canvas that calls `useEditorStore.getState().setStretchWarning("Couldn't safely apply this change; the drawing was left unchanged.")` and `console.error("[ELF stretch]", reason)` for diagnosis.
3. Clear it on the next successful stretch: call `setStretchWarning(null)` at the top of `applyAllStretches` (before applying).
4. Render it: a small dismissible amber banner in the editor shell near the AI NL bar, shown when the `stretchWarning` selector is non-null, with an X that calls `setStretchWarning(null)`. One line, visually distinct.

The user-facing message MUST NOT leak the internal `reason` (which could name element counts / scale values); `reason` goes only to `console.error`.

- [ ] **Step 6: Run all stretch tests**

Run: `npm test -- svg-stretch scoping`
Expected: PASS (normal, watchdog, invariant cases).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Checkpoint (request commit approval)**

Proposed message: `feat(dwg): stretch watchdog + invariant rollback (fail-safe)`

---

## Task 6: Golden verification on the real customer drawing (offline)

The unit tests use synthetic fixtures. This task proves the feature on the ACTUAL drawing without committing customer data.

**Files:**
- Create: `scripts/qa/spatial-scoping-golden.mjs` (run from `~/dev/elf-lab`, which has the real SVG + linkedom)

- [ ] **Step 1: Write the golden harness**

The script imports the built `view-model` + `svg-stretch` (via the `.ts` files with a resolve hook, as used earlier this session) and asserts against the real `24081-CS1-0001_Sheet_2.svg`:
- `computeViewRegions` returns exactly 2 regions with a gutter inside x `[816, 977]`.
- The near-view stack dim block maps to region 0; the end-view `21'-3"` dim maps to region 1.
- Height stretch (silencer +48): every companion (region 1) ANNOTATION element has zero scale; equipment scaled in BOTH regions; `applyMultiStretch` returns `ok: true`.
- Width stretch scoped to region 0: zero transforms land on region-1 elements.
- Watchdog: calling with `{ maxElements: 100 }` returns `ok:false` and leaves zero `data-stretch-transform` markers.

- [ ] **Step 2: Run it**

The harness imports the app's `.ts` modules directly under Node's type-stripping (Node 23+). Node ESM will not resolve their extensionless relative imports (e.g. `./svg-stretch`), so register a resolve hook that appends `.ts`. Create two tiny files in `~/dev/elf-lab`:

`~/dev/elf-lab/hooks.mjs`:

```js
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[mc]?[jt]s$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch { /* fall through */ }
  }
  return next(specifier, context);
}
```

`~/dev/elf-lab/register.mjs`:

```js
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
```

Run from `~/dev/elf-lab` (which has `linkedom` and the real SVG):

```bash
node --import ./register.mjs /Users/mike/dev/EnergyLinkFlex/scripts/qa/spatial-scoping-golden.mjs
```

The harness reads `~/dev/elf-lab/24081-CS1-0001_Sheet_2.svg`, imports the app modules by absolute path, and provides the DOM via `linkedom`'s `DOMParser`.
Expected: `ALL GOLDEN ASSERTIONS PASS`.

- [ ] **Step 3: Record the result** in `offline_lab_findings.md` (numbers, date). Do not commit the customer SVG.

---

## Task 7: Full QA gate

- [ ] **Step 1: Unit suite green**

Run: `npm test`
Expected: all tests pass (new + existing editor-store/parser/extractor).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0, no new lint errors.

- [ ] **Step 3: Golden harness green** (Task 6) on the real drawing.

- [ ] **Step 4: Write the manual browser QA checklist** to `docs/superpowers/plans/2026-07-06-spatial-scoping-QA.md` for execution once the app runs locally (port 3002) with AI creds:
  - Upload the Titan Sheet_2 DWG; open the editor.
  - Raise the silencer 4 ft: near + end silencers both grow; the overall total re-values (50'->54'); NO companion dimension text is distorted; undo returns to exact original.
  - Widen a near-view duct: only the near elevation changes; the end elevation does not slide.
  - Force a failure (temporarily lower the element budget): confirm the drawing stays unchanged and the warning shows, never a corrupt drawing.
  - Confirm performance: a stretch completes within the watchdog budget on the real drawing.

- [ ] **Step 5: Update memory** — mark punchlist #5 done in `offline_lab_findings.md` + `project_status.md` with the verification numbers.

---

## Task 8: Pre-commit hygiene (only when Mike asks to commit)

- [ ] Revert the dev-only login shortcut in `src/auth.ts` and remove `DEV_LOGIN_EMAIL` from `.env.local`.
- [ ] Confirm no customer data (DWG/SVG) is staged.
- [ ] `npm test && npx tsc --noEmit && npm run lint` all green.
- [ ] Present the full diff to Mike for commit approval. Do not push (pushing `main` triggers a prod deploy; this work stays on `wip/dwg-ai-stretch-checkpoint`).

---

## Rollback / abort strategy

If any task's tests cannot be made green within reason, STOP and surface to Mike rather than weakening a safeguard or an assertion. The safety net (Task 5) is non-negotiable: it is acceptable for a stretch to refuse and leave the drawing unchanged; it is never acceptable to show a distorted drawing. The whole feature degrades cleanly to today's behavior if `computeViewRegions` returns fewer than 2 regions, so a partial landing (Tasks 1-2 only) is still safe to ship.
