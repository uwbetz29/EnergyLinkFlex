// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { applyMultiStretch, findModelSpace, fastPosition, type StretchParams } from "../svg-stretch";
import { isAnnotationElement } from "../annotations";
import { makeTwoViewSvg } from "./fixtures";

const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml").documentElement as unknown as SVGSVGElement;
const tf = (el: Element) => el.getAttribute("transform") || "";
const hasScale = (t: string) => /scale\((?!1,\s*1\))/.test(t);
const parseTf = (t: string) => {
  const tr = t.match(/translate\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  const sc = t.match(/scale\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/);
  return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, sx: sc ? +sc[1] : 1, sy: sc ? +sc[2] : 1 };
};

// vertical stretch of the silencer band y=[500,600], +48 units, full width (height = global)
const heightSpec = { componentId: "sil", direction: "vertical", delta: 48,
  svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as const;

describe("scoped stretch rules", () => {
  it("HEIGHT: annotations never scale; equipment scales in BOTH views", () => {
    const svg = parse(makeTwoViewSvg());
    applyMultiStretch(svg, [heightSpec as StretchParams]);
    const kids = Array.from(findModelSpace(svg)!.children);
    for (const k of kids) {
      const p = fastPosition(k); if (!p) continue;
      if (isAnnotationElement(k)) {
        expect(hasScale(tf(k))).toBe(false); // annotation: translate-only, never distorted
      }
    }
    const scaledXs = kids.filter((k) => hasScale(tf(k)))
      .map((k) => fastPosition(k)?.x ?? -1);
    expect(scaledXs.some((x) => x < 400)).toBe(true);   // view 0 equipment scaled
    expect(scaledXs.some((x) => x > 1400)).toBe(true);  // view 1 equipment scaled

    // a past-zone annotation (LABEL text at y=700, above the zone) rides up rigidly
    // by delta and is NOT scaled
    const label = kids.find((k) => k.tagName === "text" && k.textContent === "LABEL")!;
    const lt = parseTf(tf(label));
    expect(lt.sx).toBe(1);
    expect(lt.sy).toBe(1);
    expect(lt.ty).toBeCloseTo(48, 5);
  });

  it("HEIGHT multi-spec: an annotation in one zone and past another composes to translate-only", () => {
    const svg = parse(makeTwoViewSvg());
    // two disjoint vertical zones: lower [500,600] +48, upper [660,720] +30.
    // LABEL at y=700 is INSIDE the upper zone (annotation -> t=0, no scale) and PAST
    // the lower zone (rigid +48). Net must be translate-only, never distorted.
    const upper = { componentId: "top", direction: "vertical", delta: 30,
      svgBounds: { top: -720, bottom: -660, left: 0, right: 2000 } } as const;
    applyMultiStretch(svg, [heightSpec as StretchParams, upper as StretchParams]);
    const kids = Array.from(findModelSpace(svg)!.children);
    const label = kids.find((k) => k.tagName === "text" && k.textContent === "LABEL")!;
    const lt = parseTf(tf(label));
    expect(lt.sx).toBe(1);
    expect(lt.sy).toBe(1);
    expect(lt.ty).toBeCloseTo(48, 5);
  });

  it("WIDTH: a view-scoped horizontal stretch leaves the other view untouched", () => {
    const svg = parse(makeTwoViewSvg());
    const widthSpec = { componentId: "duct", direction: "horizontal", delta: 24,
      svgBounds: { top: -1000, bottom: 0, left: 150, right: 250 },
      viewRegion: { xMin: 100, xMax: 300 } } as const;
    applyMultiStretch(svg, [widthSpec as StretchParams]);
    const kids = Array.from(findModelSpace(svg)!.children);
    for (const k of kids) {
      const p = fastPosition(k); if (!p) continue;
      if (p.x > 1400) expect(tf(k)).toBe(""); // view 1 completely untouched
    }
    expect(kids.some((k) => (fastPosition(k)?.x ?? 0) < 400 && tf(k) !== "")).toBe(true);

    // in-view equipment INSIDE the zone actually scales horizontally: zone x[150,250],
    // delta 24 -> scale 1.24. Guards against a regression that drops horizontal scaling.
    const inZoneEq = kids.find((k) => {
      if (isAnnotationElement(k)) return false;
      const p = fastPosition(k);
      return !!p && p.x > 150 && p.x < 250;
    })!;
    expect(parseTf(tf(inZoneEq)).sx).toBeCloseTo(1.24, 5);
  });
});

describe("stretch safeguards", () => {
  it("returns ok:true and a transformed count on a normal stretch", () => {
    const svg = parse(makeTwoViewSvg());
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 48,
      svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as StretchParams]);
    expect(r.ok).toBe(true);
    expect(r.transformed).toBeGreaterThan(0);
  });

  it("WATCHDOG: aborts and rolls back when the element budget is exceeded", () => {
    const svg = parse(makeTwoViewSvg());
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 48,
      svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as StretchParams], { maxElements: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/budget|elements/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
  });

  it("INVARIANT: aborts and rolls back a wild scale factor", () => {
    const svg = parse(makeTwoViewSvg());
    // A 1-unit zone [502,503] straddles equipment midpoints at y=502.5 (line y=[500,505]).
    // With delta 1000 that in-zone element scales ~1001x — far outside the sane bound —
    // so the post-stretch invariant must abort and roll back.
    const r = applyMultiStretch(svg, [{ componentId: "s", direction: "vertical", delta: 1000,
      svgBounds: { top: -503, bottom: -502, left: 0, right: 2000 } } as StretchParams]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scale|invariant/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
    // viewBox restored by the self-contained rollback (no saveOriginalViewBox needed)
    expect(svg.getAttribute("viewBox")).toBe("0 -1000 2000 1000");
  });

  it("INVARIANT: rejects a mirrored (negative-scale) transform even when the viewBox grows", () => {
    const svg = parse(makeTwoViewSvg());
    // horizontal delta -150 on a 100-wide zone -> scaleX = -0.5 (a mirror). Composed with
    // a vertical +4000 grow so the TOTAL viewBox area increases -> the area-shrink check
    // cannot catch it; only the non-positive-scale guard can. Must abort + roll back.
    const r = applyMultiStretch(svg, [
      { componentId: "mirror", direction: "horizontal", delta: -150,
        svgBounds: { top: -1000, bottom: 0, left: 150, right: 250 } } as StretchParams,
      { componentId: "grow", direction: "vertical", delta: 4000,
        svgBounds: { top: -600, bottom: -500, left: 0, right: 2000 } } as StretchParams,
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/mirror|scale|invariant/i);
    expect(findModelSpace(svg)!.querySelectorAll("[data-stretch-transform]").length).toBe(0);
    expect(svg.getAttribute("viewBox")).toBe("0 -1000 2000 1000"); // rolled back
  });
});
