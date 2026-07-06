// @vitest-environment jsdom
//
// ACCEPTANCE HARNESS for the nested-zone stretch composition engine.
// Spec: docs/superpowers/specs/2026-07-06-nested-zone-stretch-design.md
//
// This file is the CONTRACT the implementation is held to. It is black-box:
// it drives only the PUBLIC applyMultiStretch and reads element transforms, so it
// is independent of whatever internal structure the engine uses. Do NOT weaken an
// assertion to make it pass — fix the engine. The new nested cases fail against the
// pre-nesting engine (which skips overlapping zones); that is the intended RED.
import { describe, it, expect, vi } from "vitest";
import { applyMultiStretch, findModelSpace, fastPosition, type StretchParams } from "../svg-stretch";
import { makeNestedStackSvg } from "./fixtures";

const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml").documentElement as unknown as SVGSVGElement;
const tf = (el: Element) => el.getAttribute("transform") || "";
const parseTf = (t: string) => {
  const tr = t.match(/translate\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  const sc = t.match(/scale\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, sx: sc ? +sc[1] : 1, sy: sc ? +sc[2] : 1 };
};

// Real-drawing nesting: container [291.5,891.5] (h=600) contains silencer [531.3,627.3] (h=96).
const GAPS = 600 - 96; // 504
const child = (delta: number): StretchParams =>
  ({ componentId: "sil", direction: "vertical", delta, svgBounds: { top: -627.3, bottom: -531.3, left: 0, right: 200 } });
const container = (delta: number): StretchParams =>
  ({ componentId: "overall", direction: "vertical", delta, svgBounds: { top: -891.5, bottom: -291.5, left: 0, right: 200 } });

const kidsOf = (svg: SVGSVGElement) => Array.from(findModelSpace(svg)!.children);
const eqAtY = (kids: Element[], y: number) =>
  kids.find((k) => k.tagName === "line" && Math.abs((fastPosition(k)?.y ?? NaN) - y) < 1e-6)!;
const textOf = (kids: Element[], s: string) => kids.find((k) => k.tagName === "text" && k.textContent === s)!;
// original geometry position (fastPosition reads attributes, never the transform)
const mappedY = (el: Element) => {
  const p = fastPosition(el)!;
  const { sy, ty } = parseTf(tf(el));
  return p.y * sy + ty;
};
const vbOf = (svg: SVGSVGElement) => svg.getAttribute("viewBox")!.split(/\s+/).map(Number);

describe("nested-zone stretch — redistribute", () => {
  it("R1: container residual +48 with a held (delta 0) silencer -> gaps absorb equally, child fixed", () => {
    const svg = parse(makeNestedStackSvg());
    const r = applyMultiStretch(svg, [child(0), container(48)]);
    expect(r.ok).toBe(true);
    const kids = kidsOf(svg);

    // every gap gets the SAME scale (504+48)/504; the held silencer stays scale 1
    expect(parseTf(tf(eqAtY(kids, 400))).sy).toBeCloseTo((GAPS + 48) / GAPS, 6); // lower gap
    expect(parseTf(tf(eqAtY(kids, 750))).sy).toBeCloseTo((GAPS + 48) / GAPS, 6); // upper gap
    expect(parseTf(tf(eqAtY(kids, 580))).sy).toBeCloseTo(1, 6);                  // held child

    // below the container: untouched. above: rigid +48.
    expect(tf(eqAtY(kids, 200))).toBe("");
    const above = parseTf(tf(eqAtY(kids, 950)));
    expect(above.sy).toBeCloseTo(1, 6);
    expect(above.ty).toBeCloseTo(48, 4);

    // monotonic + continuous map (strictly increasing mapped positions)
    const ys = [200, 400, 580, 750, 950].map((y) => mappedY(eqAtY(kids, y)));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);

    // total growth 600 -> 648, reflected in the viewBox top
    const vb = vbOf(svg);
    expect(vb[3] - 1000).toBeCloseTo(48, 4);
    expect(vb[1]).toBeCloseTo(-1048, 4);
  });

  it("R2: silencer +24 AND container residual +24 -> child scales 1.25, gaps absorb +24", () => {
    const svg = parse(makeNestedStackSvg());
    const r = applyMultiStretch(svg, [child(24), container(24)]);
    expect(r.ok).toBe(true);
    const kids = kidsOf(svg);

    expect(parseTf(tf(eqAtY(kids, 580))).sy).toBeCloseTo((96 + 24) / 96, 6);   // child 1.25
    expect(parseTf(tf(eqAtY(kids, 400))).sy).toBeCloseTo((GAPS + 24) / GAPS, 6); // gap 1.047619
    expect(parseTf(tf(eqAtY(kids, 750))).sy).toBeCloseTo((GAPS + 24) / GAPS, 6);

    const above = parseTf(tf(eqAtY(kids, 950)));
    expect(above.sy).toBeCloseTo(1, 6);
    expect(above.ty).toBeCloseTo(48, 4); // 24 (child) + 24 (residual)

    const vb = vbOf(svg);
    expect(vb[3] - 1000).toBeCloseTo(48, 4);
  });

  it("TopGrow: viewBox top growth equals the true geometric top shift (residual footgun)", () => {
    const svg = parse(makeNestedStackSvg());
    applyMultiStretch(svg, [child(0), container(48)]);
    const kids = kidsOf(svg);
    const aboveShift = parseTf(tf(eqAtY(kids, 950))).ty; // rigid shift of everything above
    const vbGrowth = vbOf(svg)[3] - 1000;
    expect(vbGrowth).toBeCloseTo(aboveShift, 4);
    expect(vbGrowth).toBeCloseTo(48, 4);
  });
});

describe("nested-zone stretch — annotation hold under nesting", () => {
  it("annotations never scale; they ride their segment's near-edge offset", () => {
    const svg = parse(makeNestedStackSvg());
    applyMultiStretch(svg, [child(0), container(48)]);
    const kids = kidsOf(svg);

    for (const s of ["GAP_A", "CHILD_A", "ABOVE_A"]) {
      const a = parseTf(tf(textOf(kids, s)));
      expect(a.sx).toBe(1);
      expect(a.sy).toBe(1); // never distorted
    }
    // GAP_A in the anchored lower gap holds absolute position (offset 0)
    expect(parseTf(tf(textOf(kids, "GAP_A"))).ty).toBeCloseTo(0, 4);
    // CHILD_A inside the child rides the lower-gap expansion (segment near-edge offset)
    expect(parseTf(tf(textOf(kids, "CHILD_A"))).ty).toBeCloseTo(291.5 + 239.8 * ((GAPS + 48) / GAPS) - 531.3, 3);
    // ABOVE_A above the container rides the full +48
    expect(parseTf(tf(textOf(kids, "ABOVE_A"))).ty).toBeCloseTo(48, 4);
  });
});

describe("nested-zone stretch — edge cases", () => {
  it("Collapse: a residual that would invert a gap aborts and rolls back", () => {
    const svg = parse(makeNestedStackSvg());
    const before = svg.getAttribute("viewBox");
    const r = applyMultiStretch(svg, [child(0), container(-600)]); // -600 across 504 of gap -> negative scale
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scale|mirror|invariant/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
    expect(svg.getAttribute("viewBox")).toBe(before);
  });

  it("ZeroGap: a child abutting the container edge drops the ~0 gap (no divide-by-zero)", () => {
    const svg = parse(makeNestedStackSvg());
    // child pushed to the container's lower edge: lower gap height ~3 (<= TOL) -> dropped;
    // full residual goes to the upper gap. Must not NaN.
    const flushChild: StretchParams =
      { componentId: "sil", direction: "vertical", delta: 0, svgBounds: { top: -395, bottom: -294, left: 0, right: 200 } };
    const r = applyMultiStretch(svg, [flushChild, container(48)]);
    expect(r.ok).toBe(true);
    const kids = kidsOf(svg);
    for (const k of kids) {
      const t = parseTf(tf(k));
      expect(Number.isFinite(t.sy)).toBe(true);
      expect(Number.isFinite(t.ty)).toBe(true);
    }
    expect(vbOf(svg)[3] - 1000).toBeCloseTo(48, 4);
  });

  it("Coincident: container and sole child equal within TOL merge to one scaled segment", () => {
    const svg = parse(makeNestedStackSvg());
    // both zones = the container span; deltas sum. No gaps exist to distribute into.
    const coincident: StretchParams =
      { componentId: "dup", direction: "vertical", delta: 12, svgBounds: { top: -891.5, bottom: -291.5, left: 0, right: 200 } };
    const r = applyMultiStretch(svg, [coincident, container(36)]);
    expect(r.ok).toBe(true);
    const kids = kidsOf(svg);
    // a point inside the merged span scales by (600 + 48)/600 (summed delta 12+36)
    expect(parseTf(tf(eqAtY(kids, 580))).sy).toBeCloseTo((600 + 48) / 600, 6);
    expect(vbOf(svg)[3] - 1000).toBeCloseTo(48, 4);
  });
});

describe("nested-zone stretch — regressions preserved", () => {
  it("Disjoint: two non-overlapping vertical zones still compose independently", () => {
    const svg = parse(makeNestedStackSvg());
    // disjoint zones: lower [340,470] +20, upper [700,830] +30 (neither contains the other)
    const lower: StretchParams =
      { componentId: "a", direction: "vertical", delta: 20, svgBounds: { top: -470, bottom: -340, left: 0, right: 200 } };
    const upper: StretchParams =
      { componentId: "b", direction: "vertical", delta: 30, svgBounds: { top: -830, bottom: -700, left: 0, right: 200 } };
    const r = applyMultiStretch(svg, [lower, upper]);
    expect(r.ok).toBe(true);
    const kids = kidsOf(svg);
    // element above BOTH zones shifts by the sum (anti-"break" proof)
    expect(parseTf(tf(eqAtY(kids, 950))).ty).toBeCloseTo(50, 4);
    // total growth 50
    expect(vbOf(svg)[3] - 1000).toBeCloseTo(50, 4);
  });

  it("Partial: two partially-overlapping non-nested zones -> later skipped with a warning", () => {
    const svg = parse(makeNestedStackSvg());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A [400,600], B [500,700]: overlap but neither contains the other.
    const a: StretchParams =
      { componentId: "a", direction: "vertical", delta: 20, svgBounds: { top: -600, bottom: -400, left: 0, right: 200 } };
    const b: StretchParams =
      { componentId: "b", direction: "vertical", delta: 20, svgBounds: { top: -700, bottom: -500, left: 0, right: 200 } };
    const r = applyMultiStretch(svg, [a, b]);
    expect(r.ok).toBe(true);
    expect(warn).toHaveBeenCalled(); // the later spec is skipped with a warning
    warn.mockRestore();
  });
});
