// @vitest-environment jsdom
//
// RED HARNESS for U2 (2D cross-band scoping) — Opus owns this; Fable iterates it to
// green. It stays RED until applyMultiStretch honours StretchParams.crossBand: today
// a width stretch scales the full-height X-band, so the out-of-band `neighbour` circle
// ovals. See docs/superpowers/specs/2026-07-06-unified-2d-scoping-design.md §3.
//
// NB: named `crossband` to avoid collision with the 1D svg-stretch.scoping.test.ts.
import { describe, it, expect } from "vitest";
import { applyMultiStretch, findModelSpace, type StretchParams } from "../svg-stretch";
import { makeCrossBandSvg } from "./fixtures";

const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
const parseTf = (t: string) => {
  const tr = t.match(/translate\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  const sc = t.match(/scale\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, sx: sc ? +sc[1] : 1, sy: sc ? +sc[2] : 1 };
};
const tfOf = (svg: SVGSVGElement, id: string) =>
  parseTf(findModelSpace(svg)!.querySelector(`#${id}`)!.getAttribute("transform") || "");

// Horizontal width stretch: zone X[100,200], delta +50 → scaleX 1.5, axisGrowth 50.
// crossBand Y[40,60] = the target component's cross-axis band.
const spec = {
  componentId: "t",
  direction: "horizontal",
  delta: 50,
  svgBounds: { top: -400, bottom: 0, left: 100, right: 200 },
  crossBand: { lo: 40, hi: 60 },
} as const;

describe("U2 2D cross-band scoping", () => {
  it("row 6: an out-of-band neighbour in the zone's X-range is HELD RIGID (circle stays round)", () => {
    const svg = parse(makeCrossBandSvg());
    applyMultiStretch(svg, [spec as StretchParams]);
    const t = tfOf(svg, "neighbour");
    expect(t.sx).toBe(1); // NOT scaled on the stretch axis → no oval
    expect(t.sy).toBe(1);
  });

  it("row 4: the in-band target scales on the stretch axis", () => {
    const svg = parse(makeCrossBandSvg());
    applyMultiStretch(svg, [spec as StretchParams]);
    expect(tfOf(svg, "target").sx).toBeCloseTo(1.5, 5);
  });

  it("row 4/5 (I2): in-band & out-of-band downstream translate by the SAME axisGrowth, out-of-band never scales", () => {
    const svg = parse(makeCrossBandSvg());
    applyMultiStretch(svg, [spec as StretchParams]);
    expect(tfOf(svg, "dsInBand").tx).toBeCloseTo(50, 5);
    expect(tfOf(svg, "dsOutBand").tx).toBeCloseTo(50, 5);
    expect(tfOf(svg, "dsOutBand").sx).toBe(1);
  });

  it("upstream in-band element is untouched", () => {
    const svg = parse(makeCrossBandSvg());
    applyMultiStretch(svg, [spec as StretchParams]);
    const el = findModelSpace(svg)!.querySelector("#upstream")!;
    expect(el.getAttribute("transform") || "").toBe("");
  });

  it("band boundary: Y at cHi is in-band (scales); Y beyond cHi+AXIS_TOL is out-of-band (held)", () => {
    const svg = parse(makeCrossBandSvg());
    applyMultiStretch(svg, [spec as StretchParams]);
    expect(tfOf(svg, "bIn").sx).toBeCloseTo(1.5, 5); // y=60 == cHi → in-band
    expect(tfOf(svg, "bOut").sx).toBe(1); // y=67 > cHi+6 → out-of-band, held
  });

  it("multi-zone: two same-axis zones with different crossBands do not cross-contaminate", () => {
    const svg = parse(makeCrossBandSvg());
    const zoneB = {
      componentId: "B",
      direction: "horizontal",
      delta: 30,
      svgBounds: { top: -400, bottom: 0, left: 600, right: 700 },
      crossBand: { lo: 240, hi: 260 },
    } as const;
    applyMultiStretch(svg, [spec as StretchParams, zoneB as StretchParams]);
    // mzCross (150,250): in zoneA's X but out zoneA's band, and in zoneB's band-Y but
    // NOT zoneB's X-zone → must be identity (neither zone scales it).
    expect(tfOf(svg, "mzCross").sx).toBe(1);
    // zoneBhit (650,250): in zoneB (X+band) → scales 1.3; also downstream of zoneA → +50
    expect(tfOf(svg, "zoneBhit").sx).toBeCloseTo(1.3, 5);
    expect(tfOf(svg, "zoneBhit").tx).toBeCloseTo(50, 5);
  });
});
