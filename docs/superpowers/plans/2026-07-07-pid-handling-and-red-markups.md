# P&ID Handling + Red Markups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect P&ID vs GA sheets and gate the resize pipeline accordingly; add a persisted red markup layer (line/arrow/text) on all sheets; make zoom buttons-only.

**Architecture:** (A) A pure `classifySheetType(parseResult)` runs at parse time; P&ID sheets skip the server-side AI pre-scan and render inert with a badge. (B) A transparent `<svg>` overlay mounted INSIDE the drawing's existing zoom/pan wrapper inherits its transform (pinned through pan/zoom, immune to the stretch engine); markups live in a store slice + a `dwg_markups` jsonb column, saved via a debounced PATCH route. Pure markup geometry (hit-test/move/arrowhead) is an isolated, harness-tested module. (C) Remove wheel/pinch zoom; keep click-drag pan; make the existing +/- controls prominent.

**Tech Stack:** Next.js 16, React, Zustand, TypeScript, Vitest (jsdom), Neon Postgres (tagged-template SQL), Auth.js v5.

**Spec:** `docs/superpowers/specs/2026-07-07-pid-handling-and-red-markups-design.md`

**Naming:** the new feature is `markup` in code (the codebase already uses "annotation" for the DWG's own callout blocks — do NOT touch `annotations.ts`).

**Coordinate frame reminder:** markups store in the overlay's **viewBox** coords (what `overlaySvg.getScreenCTM()` yields). This is NOT Model_Space — the drawing has a Y-flip `(1,0,0,-1)`. Never apply a Y-flip to markup coords.

---

## Build order / phases

- **Phase A** (Tasks 1–3): sheet-type detection + gating. Ships independently.
- **Phase B** (Tasks 4–9): markup layer — geometry → store → overlay → persistence.
- **Phase C** (Task 10): buttons-only zoom. Independent; can be done any time.

Commit after every task. Run `npx tsc --noEmit` + `npm test` before each commit.

---

## Task 1: `classifySheetType` (pure detection)

**Files:**
- Create: `src/lib/dwg/sheet-type.ts`
- Test: `src/lib/dwg/__tests__/sheet-type.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/dwg/__tests__/sheet-type.test.ts
import { describe, it, expect } from "vitest";
import { classifySheetType, sheetTypeLabel, MIN_GA_DIMS } from "../sheet-type";

const base = { dimensions: [], entitySummary: { totalEntities: 0, typeCounts: {} } };
const withDims = (n: number) => ({ ...base, dimensions: Array.from({ length: n }, (_, i) => ({ handle: String(i) })) });

describe("classifySheetType", () => {
  it("GA when it has >= MIN_GA_DIMS dimension entities", () => {
    expect(classifySheetType(withDims(40) as never)).toBe("GA");
    expect(classifySheetType(withDims(MIN_GA_DIMS) as never)).toBe("GA");
  });
  it("PID when it has no dimension entities", () => {
    expect(classifySheetType(base as never)).toBe("PID");
  });
  it("PID for a schematic (0 dims, HATCH/ACAD_TABLE/VIEWPORT present)", () => {
    const pid = { dimensions: [], entitySummary: { totalEntities: 300, typeCounts: { INSERT: 302, HATCH: 12, ACAD_TABLE: 1, VIEWPORT: 2 } } };
    expect(classifySheetType(pid as never)).toBe("PID");
  });
  it("label distinguishes P&ID (schematic markers) from generic non-resizable", () => {
    const pid = { dimensions: [], entitySummary: { totalEntities: 300, typeCounts: { HATCH: 12, VIEWPORT: 2 } } };
    expect(sheetTypeLabel(pid as never)).toMatch(/P&ID/i);
    expect(sheetTypeLabel(base as never)).toMatch(/no dimensions/i);
    expect(sheetTypeLabel(withDims(40) as never)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- sheet-type` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/dwg/sheet-type.ts
import type { DwgParseResult } from "./types";

/** A GA sheet is resizable only if it has real DIMENSION entities to drive the stretch. */
export const MIN_GA_DIMS = 1;

const SCHEMATIC_MARKERS = ["HATCH", "ACAD_TABLE", "VIEWPORT"] as const;

export type SheetType = "GA" | "PID";

/** Deterministic sheet-type classification from data the parser already produces. */
export function classifySheetType(
  parseResult: Pick<DwgParseResult, "dimensions" | "entitySummary">
): SheetType {
  return (parseResult.dimensions?.length ?? 0) >= MIN_GA_DIMS ? "GA" : "PID";
}

/** Badge copy for a non-resizable sheet; "" for GA (no badge). */
export function sheetTypeLabel(
  parseResult: Pick<DwgParseResult, "dimensions" | "entitySummary">
): string {
  if (classifySheetType(parseResult) === "GA") return "";
  const counts = parseResult.entitySummary?.typeCounts ?? {};
  const schematic = SCHEMATIC_MARKERS.some((m) => (counts[m] ?? 0) > 0);
  return schematic ? "P&ID — not resizable" : "Not resizable — no dimensions";
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm test -- sheet-type` → PASS.
- [ ] **Step 5: `npx tsc --noEmit` (0 errors), then commit** — `feat(dwg): classifySheetType (GA vs P&ID detection)`

---

## Task 2: Persist `sheetType` at parse time (two distinct persistence shapes)

> **IMPORTANT — two routes, two storage shapes (verified against the code):**
> - **Single-sheet `parse/route.ts`** writes FLAT columns (`dwg_components`, `dwg_ai_sections`, …, at ~L109-115) — it does NOT build a `DwgSheet` and does NOT write `dwg_sheets`. It is also the ONLY route that runs `performPreScan`. The demo P&ID (`24189-CS1-0010`) uploads through here. → persist `sheetType` in a dedicated **`dwg_sheet_type text`** column.
> - **Multi-sheet `parse-multi/route.ts`** builds `DwgSheet` objects (`sheets.push({...})` ~L91) into the `dwg_sheets` jsonb; it does NOT run the pre-scan. → persist `sheetType` on `DwgSheet`.
> Both feed ONE store field (Task 3). The server-side prescan-skip works regardless because `sheetType` is computed locally in the route before `performPreScan`.

**Files:**
- Modify: `src/lib/dwg/types.ts` (add `DwgSheet.sheetType`)
- DB: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_sheet_type text;`
- Modify: `src/app/api/dwg/parse/route.ts` (single-sheet: classify → gate dim-blocks+prescan to GA → persist `dwg_sheet_type`)
- Modify: `src/app/api/dwg/parse-multi/route.ts` (per-sheet: set `DwgSheet.sheetType`)
- Modify: `src/app/projects/actions.ts` (add `dwg_sheet_type` to SELECTs + `Project` type)

- [ ] **Step 1: Types + DB column.** In `types.ts` add to `DwgSheet`:
```ts
  /** "GA" = resizable general arrangement; "PID" = non-resizable schematic. */
  sheetType?: import("./sheet-type").SheetType;
```
(Optional so old persisted sheets deserialize as `undefined`; read as `"GA"` for back-compat.) Run the `ADD COLUMN IF NOT EXISTS dwg_sheet_type text;` migration against Neon (same pattern used for the existing `dwg_*` columns).

- [ ] **Step 2: Gate the single-sheet route + persist the column.** In `parse/route.ts`, import `classifySheetType`. After the parse result is available and BEFORE `extractDimBlocksFromSvg`/`performPreScan` (~L61-62), compute `const sheetType = classifySheetType(parseResult);`. Gate BOTH the dim-block extraction and the pre-scan behind GA (no reason to compute dim blocks for a skipped scan):
```ts
let aiSections = null;
if (sheetType === "GA") {
  const dimBlockInfo = extractDimBlocksFromSvg(parseResult.svg); // was ~L61, now gated
  try {
    const preScanResult = await performPreScan({ /* existing args, incl. dimBlockInfo */ });
    aiSections = preScanResult;
    console.log(`[ELF prescan] ${preScanResult.sections.length} sections: ${preScanResult.summary}`);
  } catch (err) {
    console.error("[ELF prescan] Failed (non-blocking):", err);
  }
} else {
  console.log(`[ELF prescan] skipped — sheetType=${sheetType} (not resizable)`);
}
```
Add `dwg_sheet_type = ${sheetType}` to the `UPDATE projects SET ...` (~L109-115) and include `sheetType` in the returned `NextResponse.json({...})` (~L117).

- [ ] **Step 3: Set it in the multi-sheet route.** In `parse-multi/route.ts`, where each sheet is pushed (~L91, `parseResult` in scope), add `sheetType: classifySheetType(parseResult)` to the `DwgSheet` object. (No pre-scan here; no gating needed.)

- [ ] **Step 4: Load path.** In `actions.ts`, add `dwg_sheet_type` to the explicit `SELECT` lists in `getProject`/`listProjects` and to the `Project` interface (`dwg_sheet_type: string | null`).

- [ ] **Step 5: Verify** — `npx tsc --noEmit` → 0. Confirm both routes compile; the single-sheet route persists `dwg_sheet_type`; the multi route puts `sheetType` on each `DwgSheet` (jsonb, no schema change for that path).
- [ ] **Step 6: Commit** — `feat(dwg): classify + persist sheetType (both routes); skip dim-blocks+prescan on P&ID`

---

## Task 3: Client gate + badge (make P&ID inert)

**Files:**
- Modify: `src/stores/editor-store.ts` (expose active `sheetType`)
- Modify: `src/components/editor/svg-drawing-canvas.tsx` (skip populating stretch components / dim-clicks; render badge)
- Modify: `src/components/editor/editor-shell.tsx` (hide `ComponentSidebar` + `NLBar` when P&ID)

- [ ] **Step 1: Store — expose sheetType.** Add `sheetType: SheetType` to `EditorState` (default `"GA"`) plus a `setSheetType: (t: SheetType) => void` action. Consume it from **both** `editor-shell.tsx` hydrate branches (they are distinct — Task 2 note):
  - **Multi-sheet branch** (~L95, `project.dwg_sheets`): set from the active sheet — either extend `setActiveSheet` with `sheetType: sheet.sheetType ?? "GA"` in its `set({...})`, or call `setSheetType(firstSheet.sheetType ?? "GA")` after `setSheets`.
  - **Flat single-sheet branch** (~L131, `project.dwg_components`): call `setSheetType(project.dwg_sheet_type ?? "GA")`.
  Read in the canvas/shell via `useEditorStore((s) => s.sheetType)`.

- [ ] **Step 2: Canvas gate.** In `svg-drawing-canvas.tsx`, guard the effects that (a) populate stretch `components` from AI sections / extracted dims and (b) call `setupDimensionClicks`, with `if (sheetType === "PID") return;` so no resize affordance is wired. Render a badge (reuse the `stretchWarning` pill styling) when `sheetType === "PID"` using a **static copy** — do NOT call `sheetTypeLabel` here (it needs the `parseResult`, which the client does not have; only the `"GA"/"PID"` string is persisted):
```tsx
{sheetType === "PID" && (
  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl
                  bg-slate-100 border border-slate-300 text-slate-600 text-[12px] font-semibold shadow-md">
    {"P&ID — not resizable"}
  </div>
)}
```
(If the finer copy distinction from spec §3a is wanted later, persist the `sheetTypeLabel(...)` string in its own column at parse time; out of scope for v1 — one generic PID badge.)

- [ ] **Step 3: Shell gate.** In `editor-shell.tsx`, when `sheetType === "PID"`, do not render `ComponentSidebar` and `NLBar` (they are always-mounted today). The markup toolbar (Task 8) is rendered regardless.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 0; `npm test` still green. Manual: a P&ID sheet shows the badge, no sidebar/NL bar, no dimension-click cursor.
- [ ] **Step 5: Commit** — `feat(editor): gate resize UI + badge for P&ID sheets`

---

## Task 4: Markup types + the RED geometry harness

> **Fable note:** Task 5 (the geometry *implementation*) is the one Fable-eligible unit. This task (Opus) writes the harness so it is RED. Per fable-operating-model, either farm Task 5 to Fable via a one-stage Workflow (`agent(prompt, { model: 'fable', effort: 'low', schema })`) or let Opus implement it — the harness below is identical either way. Default: Opus, since the geometry is routine.

**Files:**
- Modify: `src/lib/dwg/types.ts` (add the `Markup` union)
- Test: `src/lib/dwg/__tests__/markup-geometry.test.ts` (RED — module doesn't exist yet)

- [ ] **Step 1: Add the data model** to `types.ts`:
```ts
export type MarkupId = string;
interface MarkupBase { id: MarkupId; sheetNumber: number; }
export interface LineMarkup  extends MarkupBase { type: "line";  x1: number; y1: number; x2: number; y2: number; }
export interface ArrowMarkup extends MarkupBase { type: "arrow"; x1: number; y1: number; x2: number; y2: number; }
export interface TextMarkup  extends MarkupBase { type: "text";  x: number;  y: number;  text: string; }
export type Markup = LineMarkup | ArrowMarkup | TextMarkup;
```

- [ ] **Step 2: Write the failing harness** (the acceptance criteria, §7 of the spec):
```ts
// src/lib/dwg/__tests__/markup-geometry.test.ts
import { describe, it, expect } from "vitest";
import { hitTest, moveMarkup, arrowGeometry, normalizeDrag, TEXT_CHAR_W } from "../markup-geometry";
import type { Markup } from "../types";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): Markup =>
  ({ id, sheetNumber: 1, type: "line", x1, y1, x2, y2 });
const text = (id: string, x: number, y: number, t: string): Markup =>
  ({ id, sheetNumber: 1, type: "text", x, y, text: t });

describe("hitTest", () => {
  it("hits a point on the segment, misses a point > tol away", () => {
    const m = [line("a", 0, 0, 100, 0)];
    expect(hitTest(m, { x: 50, y: 1 }, 3)).toBe("a");
    expect(hitTest(m, { x: 50, y: 10 }, 3)).toBeNull();
  });
  it("returns the top-most (last-added) among overlapping markups", () => {
    const m = [line("a", 0, 0, 100, 0), line("b", 0, 0, 100, 0)];
    expect(hitTest(m, { x: 50, y: 0 }, 3)).toBe("b");
  });
  it("uses a bbox for text markups", () => {
    const m = [text("t", 10, 10, "HELLO")];
    expect(hitTest(m, { x: 12, y: 8 }, 3)).toBe("t");           // inside bbox
    expect(hitTest(m, { x: 10 + 5 * TEXT_CHAR_W + 50, y: 10 }, 3)).toBeNull(); // far right
  });
});

describe("moveMarkup", () => {
  it("translates every coord of a line and returns a NEW object", () => {
    const a = line("a", 0, 0, 10, 10);
    const b = moveMarkup(a, 5, -3);
    expect(b).toMatchObject({ x1: 5, y1: -3, x2: 15, y2: 7 });
    expect(a).toMatchObject({ x1: 0, y1: 0 }); // unchanged (no mutation)
    expect(b).not.toBe(a);
  });
  it("translates a text markup's anchor", () => {
    expect(moveMarkup(text("t", 4, 4, "x"), 2, 2)).toMatchObject({ x: 6, y: 6 });
  });
});

describe("arrowGeometry", () => {
  it("head sits at (x2,y2), is symmetric, and scales with head params", () => {
    const g = arrowGeometry(0, 0, 100, 0, 10, 8);
    // two barbs, both behind the tip on the shaft axis, symmetric about y=0
    expect(g.length).toBe(2);
    expect(g[0].x).toBeCloseTo(90, 1); expect(g[1].x).toBeCloseTo(90, 1);
    expect(g[0].y).toBeCloseTo(-4, 1); expect(g[1].y).toBeCloseTo(4, 1);
  });
  it("degrades gracefully on a near-zero shaft (no NaN)", () => {
    const g = arrowGeometry(5, 5, 5, 5, 10, 8);
    expect(g.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("normalizeDrag", () => {
  it("returns null below tol, else an ordered segment", () => {
    expect(normalizeDrag({ x: 0, y: 0 }, { x: 1, y: 1 }, 5)).toBeNull();
    expect(normalizeDrag({ x: 0, y: 0 }, { x: 40, y: 0 }, 5)).toMatchObject({ x1: 0, y1: 0, x2: 40, y2: 0 });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npm test -- markup-geometry` → FAIL (module not found). Leave RED.
- [ ] **Step 4: Commit the RED harness + types** — `test(dwg): RED harness for markup-geometry + Markup types`

---

## Task 5: `markup-geometry.ts` (Fable-eligible implementation)

**Files:**
- Create: `src/lib/dwg/markup-geometry.ts`
- Test: (Task 4's harness — iterate to GREEN)

- [ ] **Step 1: Implement to satisfy the harness.**
```ts
// src/lib/dwg/markup-geometry.ts
import type { Markup } from "./types";

export const TEXT_CHAR_W = 7;   // rough per-char advance (px in viewBox units) for hit-test bbox
export const TEXT_H = 14;

export interface Pt { x: number; y: number; }

/** Squared distance from p to segment ab. */
function distSqToSeg(p: Pt, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = p.x - cx, ey = p.y - cy;
  return ex * ex + ey * ey;
}

/** Top-most markup id whose geometry is within tol of pt, else null. */
export function hitTest(markups: Markup[], pt: Pt, tol: number): string | null {
  const tol2 = tol * tol;
  for (let i = markups.length - 1; i >= 0; i--) {   // last-added = top-most
    const m = markups[i];
    if (m.type === "text") {
      const w = Math.max(1, m.text.length) * TEXT_CHAR_W;
      if (pt.x >= m.x - tol && pt.x <= m.x + w + tol && pt.y >= m.y - TEXT_H - tol && pt.y <= m.y + tol) return m.id;
    } else {
      if (distSqToSeg(pt, m.x1, m.y1, m.x2, m.y2) <= tol2) return m.id;
    }
  }
  return null;
}

/** Return a NEW markup translated by (dx,dy). Never mutates input. */
export function moveMarkup(m: Markup, dx: number, dy: number): Markup {
  if (m.type === "text") return { ...m, x: m.x + dx, y: m.y + dy };
  return { ...m, x1: m.x1 + dx, y1: m.y1 + dy, x2: m.x2 + dx, y2: m.y2 + dy };
}

/** The two arrowhead barb points at the (x2,y2) tip. Robust to a zero-length shaft. */
export function arrowGeometry(x1: number, y1: number, x2: number, y2: number, headLen: number, headWidth: number): Pt[] {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = len > 1e-6 ? dx / len : 1;   // unit shaft dir; default +x on degenerate
  const uy = len > 1e-6 ? dy / len : 0;
  const bx = x2 - ux * headLen, by = y2 - uy * headLen;   // base of the head, back along shaft
  const nx = -uy, ny = ux;                                // unit normal
  const half = headWidth / 2;
  return [
    { x: bx + nx * half, y: by + ny * half },
    { x: bx - nx * half, y: by - ny * half },
  ];
}

/** Ordered segment from a drag, or null if shorter than tol. */
export function normalizeDrag(start: Pt, end: Pt, tol: number): { x1: number; y1: number; x2: number; y2: number } | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < tol) return null;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
```

- [ ] **Step 2: Run to verify GREEN** — `npm test -- markup-geometry` → PASS (all cases). If farmed to Fable, this is Fable's reward signal; Opus then re-runs the full suite + `tsc` + reads the diff adversarially before accepting.
- [ ] **Step 3: `npx tsc --noEmit` → 0, commit** — `feat(dwg): markup-geometry (hit-test/move/arrowhead/drag)`

---

## Task 6: Markup store slice

**Files:**
- Modify: `src/stores/editor-store.ts`
- Test: `src/stores/__tests__/markup-store.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/stores/__tests__/markup-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editor-store";

const reset = () => useEditorStore.setState({ markups: [], selectedMarkupId: null, markupTool: "pan" });

describe("markup store slice", () => {
  beforeEach(reset);
  it("addMarkup appends and returns via state", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(useEditorStore.getState().markups).toHaveLength(1);
  });
  it("updateMarkup replaces by id", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "text", x: 0, y: 0, text: "a" });
    useEditorStore.getState().updateMarkup("m1", { text: "b" });
    expect((useEditorStore.getState().markups[0] as { text: string }).text).toBe("b");
  });
  it("deleteMarkup removes and clears selection", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    useEditorStore.getState().selectMarkup("m1");
    useEditorStore.getState().deleteMarkup("m1");
    expect(useEditorStore.getState().markups).toHaveLength(0);
    expect(useEditorStore.getState().selectedMarkupId).toBeNull();
  });
  it("setMarkupTool switches tool", () => {
    useEditorStore.getState().setMarkupTool("arrow");
    expect(useEditorStore.getState().markupTool).toBe("arrow");
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement the slice** in `editor-store.ts`. Add to `EditorState`:
```ts
  markups: Markup[];
  selectedMarkupId: MarkupId | null;
  markupTool: "pan" | "select" | "line" | "arrow" | "text";
  addMarkup: (m: Markup) => void;
  updateMarkup: (id: MarkupId, patch: Partial<Markup>) => void;
  deleteMarkup: (id: MarkupId) => void;
  selectMarkup: (id: MarkupId | null) => void;
  setMarkupTool: (t: EditorState["markupTool"]) => void;
  setMarkups: (m: Markup[]) => void;   // hydrate on load
```
Initial state: `markups: [], selectedMarkupId: null, markupTool: "pan"`. Actions:
```ts
  addMarkup: (m) => set((s) => ({ markups: [...s.markups, m] })),
  updateMarkup: (id, patch) => set((s) => ({
    markups: s.markups.map((m) => (m.id === id ? ({ ...m, ...patch } as Markup) : m)),
  })),
  deleteMarkup: (id) => set((s) => ({
    markups: s.markups.filter((m) => m.id !== id),
    selectedMarkupId: s.selectedMarkupId === id ? null : s.selectedMarkupId,
  })),
  selectMarkup: (id) => set({ selectedMarkupId: id }),
  setMarkupTool: (t) => set({ markupTool: t }),
  setMarkups: (m) => set({ markups: m }),
```
Import `Markup, MarkupId` from `@/lib/dwg/types`.

- [ ] **Step 4: Run → PASS**, `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** — `feat(store): markup slice (CRUD + tool + hydrate)`

---

## Task 7: `MarkupOverlay` component (render + interaction)

**Files:**
- Create: `src/components/editor/markup-overlay.tsx`
- Modify: `src/components/editor/svg-drawing-canvas.tsx` (mount overlay inside the transform wrapper; pass the drawing viewBox + w/h)

- [ ] **Step 1: Build the overlay.** A transparent `<svg>` that mirrors the drawing's viewBox and fills the wrapper (`width/height: 100%`), so it inherits the wrapper's `translate`+pixel-size transform. `pointerEvents` is `auto` only when a markup tool is active (`markupTool !== "pan"`), so click-drag pan still works in pan mode.
```tsx
// src/components/editor/markup-overlay.tsx  (structure — fill in per existing canvas patterns)
"use client";
import { useRef, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { hitTest, moveMarkup, arrowGeometry, normalizeDrag, type Pt } from "@/lib/dwg/markup-geometry";
import type { Markup } from "@/lib/dwg/types";

const RED = "#e11d2a";
const HIT_TOL = 6;            // viewBox units
const DRAG_MIN = 4;

export function MarkupOverlay({ viewBox, sheetNumber }: { viewBox: string; sheetNumber: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { markups, selectedMarkupId, markupTool } = useEditorStore();
  const { addMarkup, updateMarkup, selectMarkup, setMarkupTool } = useEditorStore.getState();
  const [draft, setDraft] = useState<{ start: Pt; end: Pt } | null>(null);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null);

  const active = markupTool !== "pan";
  const sheetMarkups = markups.filter((m) => m.sheetNumber === sheetNumber);

  // screen → viewBox via the overlay's own CTM (exact; no formula duplication)
  const toDrawing = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const d = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: d.x, y: d.y };
  };
  const newId = () => `mk_${sheetNumber}_${useEditorStore.getState().markups.length}_${performance.now().toString(36)}`;

  // pointer handlers implement §3b of the spec: line/arrow drag, text click, select+drag, delete.
  // (See spec §3b decision table. Use normalizeDrag for line/arrow commit, hitTest for select,
  //  moveMarkup for drag, and an inline <input>/<textarea> for text edit.)

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0"
      style={{ width: "100%", height: "100%", pointerEvents: active ? "auto" : "none", cursor: active ? "crosshair" : "default" }}
      onPointerDown={/* per §3b */ undefined}
      onPointerMove={/* rubber-band draft / drag */ undefined}
      onPointerUp={/* commit */ undefined}
    >
      {sheetMarkups.map((m) => renderMarkup(m, m.id === selectedMarkupId))}
      {draft && markupTool !== "select" && renderDraft(draft, markupTool)}
    </svg>
  );
}

function renderMarkup(m: Markup, selected: boolean) { /* line/arrow: <line>+<polyline> head via arrowGeometry; text: <text>; selected → thin blue halo */ }
function renderDraft(/*...*/) { /* live preview during drag */ }
```
Implementation notes for the executing agent:
- **Line/Arrow:** in `line`/`arrow` mode, pointerdown sets `draft.start`; pointermove updates `draft.end`; pointerup calls `normalizeDrag`; if non-null, `addMarkup({ id, sheetNumber, type, ...seg })` then `setMarkupTool("select")`. Arrow renders the shaft `<line>` plus a `<polyline>`/`<polygon>` from `arrowGeometry(...,x2,y2, 14, 12)`.
- **Text:** in `text` mode, pointerdown places an inline `<input>` (HTML, absolutely positioned at the screen point) → on Enter/blur, if non-empty `addMarkup({type:"text", x, y, text})`; empty discarded; then `setMarkupTool("select")`.
- **Select:** pointerdown → `hitTest(sheetMarkups, pt, HIT_TOL)`; select or clear; drag a selected markup with `moveMarkup` (accumulate delta, `updateMarkup` on move/commit); double-click a text markup → inline editor to change `text`.
- **Delete:** a keydown listener (Delete/Backspace) on the overlay (or shell) removes `selectedMarkupId`. Guard so it doesn't fire while typing in the text input.
- All strokes/fills `RED`; selected markups get a thin blue outline (not red) so selection reads distinctly.

- [ ] **Step 2: Mount it** in `svg-drawing-canvas.tsx` as a sibling INSIDE the transform wrapper (the `<div>` at ~L1599-1606, alongside `svgContainerRef` and the component-overlay div):
```tsx
{svgLoaded && svgViewBox && (
  <MarkupOverlay
    viewBox={`${svgViewBox.minX} ${svgViewBox.minY} ${svgViewBox.width} ${svgViewBox.height}`}
    sheetNumber={currentSheet}
  />
)}
```

- [ ] **Step 3: Manual verification (preview MCP).** Start dev on 3002; on a sheet, pick Line → drag → a red line appears and stays pinned through +/- zoom and drag-pan; Arrow → red arrow with head at the release end; Text → type → red label; Select → drag to move, double-click to edit, Delete to remove. Confirm pan still works in "pan" mode (overlay pass-through).
- [ ] **Step 4: `npx tsc --noEmit` → 0, commit** — `feat(editor): red markup overlay (line/arrow/text; select/drag/edit/delete)`

---

## Task 8: Markup toolbar

**Files:**
- Modify: `src/components/editor/svg-drawing-canvas.tsx` (or a small `markup-toolbar.tsx`)

- [ ] **Step 1: Add a visible toolbar** (all sheets, GA + P&ID) with buttons: **Pan** (default), **Select**, **Line**, **Arrow**, **Text**, each calling `setMarkupTool(...)`, with the active tool highlighted (read `markupTool`). Place it as a floating control cluster (mirror the existing zoom-button styling at ~L1747). A "Delete" affordance appears when `selectedMarkupId` is set.
- [ ] **Step 2: Manual check** — switching tools changes the cursor/behavior; active tool is visually indicated.
- [ ] **Step 3: Commit** — `feat(editor): markup toolbar (pan/select/line/arrow/text)`

---

## Task 9: Persistence (`dwg_markups` column + PATCH route + load/save)

**Files:**
- DB: add `dwg_markups jsonb` column (Neon) — `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dwg_markups jsonb;`
- Create: `src/app/api/dwg/markups/route.ts`
- Modify: `src/app/projects/actions.ts` (add `dwg_markups` to `getProject`/`listProjects` SELECT + `Project` type)
- Modify: `src/components/editor/editor-shell.tsx` (hydrate `setMarkups` on load; debounced save on change)

- [ ] **Step 1: DB column.** Run the `ADD COLUMN IF NOT EXISTS` migration against Neon (follow how existing `dwg_*` columns were added; store as `{ [sheetNumber]: Markup[] }`).
- [ ] **Step 2: PATCH route.** `src/app/api/dwg/markups/route.ts`, authed exactly like the other `src/app/api/dwg/*` routes (session check + project-ownership check). Body `{ projectId, markupsBySheet }`; validate shape; `UPDATE projects SET dwg_markups = ${json}::jsonb WHERE id = ${projectId} AND user_id = ${session.user.id}`. Return `{ ok: true }`. Reject unauthorized/oversized payloads.
- [ ] **Step 3: Load path.** In `actions.ts`, add `dwg_markups` to the explicit `SELECT` column lists in `getProject` and `listProjects`, add it to the `Project` interface (`dwg_markups: Record<number, Markup[]> | null`). In `EditorShell`, on hydrate call `setMarkups(flatten(project.dwg_markups))` (flatten the `{sheetNumber: Markup[]}` map into the flat `markups[]`, or store per-sheet — keep it consistent with the store slice which filters by `sheetNumber`).
- [ ] **Step 4: Save path.** In `EditorShell` (or a small hook), subscribe to `markups` and debounce (~800ms) a `fetch("/api/dwg/markups", { method: "PATCH", body: JSON.stringify({ projectId, markupsBySheet: groupBySheet(markups) }) })`. Only fires when `projectId` is set. This is markup-only; do NOT touch dim edits.
- [ ] **Step 5: Round-trip verification.** Draw markups → wait for save (network tab shows PATCH 200) → reload → markups reappear on the correct sheets. `npx tsc --noEmit` → 0; `npm test` green.
- [ ] **Step 6: Commit** — `feat(dwg): persist markups (dwg_markups jsonb + PATCH route + load/save)`

---

## Task 10: Buttons-only zoom (remove wheel/pinch; prominent controls)

**Files:**
- Modify: `src/components/editor/svg-drawing-canvas.tsx`

- [ ] **Step 1: Remove wheel/pinch zoom.** Delete the `wheel` listener effect (~L1401-1447: the `handler` that reads `e.deltaY` / `e.ctrlKey` and calls `state.setZoom(newZoom)` + `addEventListener("wheel", ...)`). No wheel or pinch changes zoom after this. Keep the click-drag pan handler untouched.
- [ ] **Step 2: Make the zoom controls prominent.** Restyle the existing +/- / fit cluster (~L1747-1770) to be obviously visible: larger tap targets (e.g. `w-11 h-11`), stronger contrast/border, a persistent zoom-% readout between the buttons, and a clear grouping (e.g. a rounded card with a subtle label "Zoom"). Keep the `setZoom(zoom * 1.25)` / `* 0.8` / `zoomFit` behaviour and the store's [0.1, 5] clamp.
- [ ] **Step 3: Manual check (preview MCP).** Wheel/trackpad over the canvas does NOT zoom; the +/- buttons do; the % readout updates; drag still pans. Screenshot for the user.
- [ ] **Step 4: `npx tsc --noEmit` → 0, commit** — `feat(editor): buttons-only zoom (remove wheel/pinch; prominent controls)`

---

## Done criteria
- `npm test` green (new: sheet-type, markup-geometry, markup-store), `npx tsc --noEmit` 0, eslint 0 new errors.
- A P&ID sheet: badge shown, resize UI inert, markups still work.
- A GA sheet: resize unchanged; markups work and persist across reload.
- Zoom is buttons-only with prominent controls; pan is click-drag; markups stay pinned through both.
- No customer `.dwg/.svg` committed; `auth.ts` dev-login reverted before any commit.
