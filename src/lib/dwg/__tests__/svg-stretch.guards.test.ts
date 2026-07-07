// @vitest-environment jsdom
//
// Quick-guard behavior for the stretch engine (bug #3 — width edit distorted
// neighbors into ovals and stretched text). Two guards:
//   1. a <g>-wrapped text label is NEVER scaled (only translated)
//   2. a stretch whose zone scale is grossly out of range is refused + rolled
//      back, so the safety net warns instead of silently shipping a smear.
// Black-box against the public applyMultiStretch. Do not weaken to pass — fix the engine.
import { describe, it, expect } from "vitest";
import { applyMultiStretch, findModelSpace, type StretchParams } from "../svg-stretch";

const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml").documentElement as unknown as SVGSVGElement;
const tf = (el: Element) => el.getAttribute("transform") || "";
const sxOf = (el: Element) => {
  const m = tf(el).match(/scale\(\s*([-\d.eE]+)/);
  return m ? +m[1] : 1;
};

// A horizontal band mirroring real LibreDWG structure: each entity in its OWN <g>.
// Stretch zone = X in [150, 250]. A label, a circle and equipment sit inside the band.
function makeHBandSvg(): string {
  return `<svg viewBox="0 -1000 1000 1000" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      <g id="eq"><line x1="200" y1="500" x2="202" y2="500"/></g>
      <g id="lbl"><text x="200" y="500">10'-8"</text></g>
      <g id="circ"><circle cx="200" cy="500" r="10"/></g>
      <g id="left"><line x1="50" y1="500" x2="52" y2="500"/></g>
    </g></g></svg>`;
}
const hZone = (delta: number): StretchParams => ({
  componentId: "w",
  direction: "horizontal",
  delta,
  svgBounds: { top: -1000, bottom: 0, left: 150, right: 250 },
});

describe("stretch quick-guards", () => {
  it("never scales a <g>-wrapped text label (equipment in-band scales, label does not)", () => {
    const svg = parse(makeHBandSvg());
    const r = applyMultiStretch(svg, [hZone(100)]); // zone 100 -> 200, scale 2.0 (under cap)
    expect(r.ok).toBe(true);
    const ms = findModelSpace(svg)!;
    const g = (id: string) => ms.querySelector(`#${id}`)!;
    expect(sxOf(g("eq"))).toBeCloseTo(2, 6); // equipment scales with the band
    expect(sxOf(g("lbl"))).toBe(1);          // text label is held rigid (the fix)
    expect(tf(g("left"))).toBe("");          // left of the zone: untouched
  });

  it("rejects a gross distortion (>2.5x) and rolls back instead of shipping it", () => {
    const svg = parse(makeHBandSvg());
    const before = svg.getAttribute("viewBox");
    const r = applyMultiStretch(svg, [hZone(300)]); // zone 100 -> 400, scale 4.0 (over cap)
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/distort|scale/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
    expect(svg.getAttribute("viewBox")).toBe(before);
  });

  it("still allows a normal resize (1.25x) — the guard does not block real edits", () => {
    const svg = parse(makeHBandSvg());
    const r = applyMultiStretch(svg, [hZone(25)]); // zone 100 -> 125, scale 1.25
    expect(r.ok).toBe(true);
  });
});
