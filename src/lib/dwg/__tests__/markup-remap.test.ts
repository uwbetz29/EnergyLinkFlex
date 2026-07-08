import { describe, it, expect } from "vitest";
import { composeStretchGroups, type StretchParams } from "../svg-stretch";
import {
  remapPointForward,
  remapPointInverse,
  remapMarkupForward,
} from "../markup-remap";
import type { Markup } from "../types";

/**
 * Contract for the markup remap (fix #2, B5).
 *
 * Markups are stored in the drawing's ORIGINAL (unstretched) viewBox coordinates
 * (Y-down). `remapPointForward` maps a base point to where it lands after a
 * stretch, moving IDENTICALLY to how the drawing geometry at that point moves —
 * so a markup pinned to a feature tracks it. `remapPointInverse` is the exact
 * inverse (used to convert live pointer coords back to base while stretched).
 *
 * The remap consumes the SAME AxisGroup[] the geometry uses (from
 * composeStretchGroups), so fidelity is by construction. Semantics mirror
 * applyMultiStretch's per-element loop with the markup treated as EQUIPMENT
 * (non-annotation): in-band points scale (c -> f(c) = mapPoint), out-of-band /
 * out-of-viewRegion points ride rigidly (no scale, near-edge offset only).
 *
 * Coordinate spaces:
 *   viewBox (x, y)  <->  internal Model_Space (x, -y)   [the drawing's Y-flip]
 * A vertical stretch zone at viewBox y in [top, bottom] (top more negative) is
 * internal y in [-bottom, -top].
 */

/** A vertical stretch: internal zone [40, 100] (viewBox y in [-100, -40]),
 *  delta 30 -> scale (60+30)/60 = 1.5. */
function verticalStretch(): StretchParams {
  return {
    componentId: "v",
    svgBounds: { top: -100, bottom: -40, left: 0, right: 1000 },
    direction: "vertical",
    delta: 30,
  };
}

/** A horizontal stretch: internal zone [200, 260], delta 30 -> scale 1.5. */
function horizontalStretch(): StretchParams {
  return {
    componentId: "h",
    svgBounds: { top: -1000, bottom: 0, left: 200, right: 260 },
    direction: "horizontal",
    delta: 30,
  };
}

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
function expectPt(got: { x: number; y: number }, x: number, y: number) {
  expect(close(got.x, x), `x: got ${got.x}, want ${x}`).toBe(true);
  expect(close(got.y, y), `y: got ${got.y}, want ${y}`).toBe(true);
}

describe("remapPointForward — identity when no stretch", () => {
  it("returns the point unchanged for empty groups", () => {
    expectPt(remapPointForward({ x: 123, y: -456 }, []), 123, -456);
  });
});

describe("remapPointForward — single vertical stretch (zone internal [40,100], x1.5)", () => {
  const groups = composeStretchGroups([verticalStretch()]);

  it("leaves a point BELOW the zone unchanged (viewBox y=-20 -> internal 20 < 40)", () => {
    expectPt(remapPointForward({ x: 5, y: -20 }, groups), 5, -20);
  });

  it("shifts a point ABOVE the zone up by the growth (viewBox y=-150 -> -180)", () => {
    // internal 150 > 100; rides +30 growth -> internal 180 -> viewBox -180
    expectPt(remapPointForward({ x: 5, y: -150 }, groups), 5, -180);
  });

  it("scales a point IN the zone from the near edge (viewBox y=-70 -> -85)", () => {
    // internal 70 -> f(70)=40+(70-40)*1.5=85 -> viewBox -85
    expectPt(remapPointForward({ x: 5, y: -70 }, groups), 5, -85);
  });

  it("never moves x under a vertical stretch", () => {
    expect(remapPointForward({ x: 777, y: -70 }, groups).x).toBe(777);
  });
});

describe("remapPointForward — single horizontal stretch (zone internal [200,260], x1.5)", () => {
  const groups = composeStretchGroups([horizontalStretch()]);

  it("leaves a point LEFT of the zone unchanged (x=150)", () => {
    expectPt(remapPointForward({ x: 150, y: -33 }, groups), 150, -33);
  });

  it("shifts a point RIGHT of the zone by the growth (x=300 -> 330)", () => {
    expectPt(remapPointForward({ x: 300, y: -33 }, groups), 330, -33);
  });

  it("scales a point IN the zone from the near edge (x=230 -> 245)", () => {
    // f(230)=200+(230-200)*1.5=245
    expectPt(remapPointForward({ x: 230, y: -33 }, groups), 245, -33);
  });
});

describe("remapPointForward — combined disjoint axes", () => {
  const groups = composeStretchGroups([verticalStretch(), horizontalStretch()]);

  it("maps each axis independently ((230,-70) -> (245,-85))", () => {
    expectPt(remapPointForward({ x: 230, y: -70 }, groups), 245, -85);
  });

  it("maps a point above+right of both zones by both growths ((300,-150) -> (330,-180))", () => {
    expectPt(remapPointForward({ x: 300, y: -150 }, groups), 330, -180);
  });
});

describe("remapPointForward — viewRegion gating (horizontal, only inside the edited view moves)", () => {
  const stretch: StretchParams = {
    ...horizontalStretch(),
    viewRegion: { xMin: 190, xMax: 270 },
  };
  const groups = composeStretchGroups([stretch]);

  it("scales a point INSIDE the viewRegion (x=230 -> 245)", () => {
    expectPt(remapPointForward({ x: 230, y: -33 }, groups), 245, -33);
  });

  it("leaves a point OUTSIDE the viewRegion unchanged (x=400)", () => {
    expectPt(remapPointForward({ x: 400, y: -33 }, groups), 400, -33);
  });
});

describe("remapPointForward — crossBand gating (vertical, only in-band scales)", () => {
  const stretch: StretchParams = {
    ...verticalStretch(),
    crossBand: { lo: 0, hi: 50 },
  };
  const groups = composeStretchGroups([stretch]);

  it("scales an IN-BAND in-zone point (x=25, viewBox y=-70 -> -85)", () => {
    expectPt(remapPointForward({ x: 25, y: -70 }, groups), 25, -85);
  });

  it("rides an OUT-OF-BAND in-zone point rigidly (x=100 stays put)", () => {
    // cross x=100 outside [0-6, 50+6); anchored segment near-edge offset = 0 -> unchanged
    expectPt(remapPointForward({ x: 100, y: -70 }, groups), 100, -70);
  });
});

describe("remapPointInverse — exact inverse of forward", () => {
  it("is identity for empty groups", () => {
    expectPt(remapPointInverse({ x: 12, y: -34 }, []), 12, -34);
  });

  it("inverts a single vertical stretch (viewBox -85 -> -70)", () => {
    const groups = composeStretchGroups([verticalStretch()]);
    expectPt(remapPointInverse({ x: 5, y: -85 }, groups), 5, -70);
  });

  it("inverts a single horizontal stretch (x 245 -> 230)", () => {
    const groups = composeStretchGroups([horizontalStretch()]);
    expectPt(remapPointInverse({ x: 245, y: -33 }, groups), 230, -33);
  });

  it("round-trips forward∘inverse ≈ identity across zones (combined disjoint)", () => {
    const groups = composeStretchGroups([verticalStretch(), horizontalStretch()]);
    for (const pt of [
      { x: 5, y: -20 },
      { x: 230, y: -70 },
      { x: 300, y: -150 },
      { x: 255, y: -95 },
    ]) {
      const back = remapPointInverse(remapPointForward(pt, groups), groups);
      expectPt(back, pt.x, pt.y);
    }
  });
});

describe("remapPointInverse — viewRegion round-trip (regression: tail-past-xMax must invert)", () => {
  // horizontal zone internal [200,260] delta 30 (scale 1.5), scoped to view [190,270].
  const groups = composeStretchGroups([
    { ...horizontalStretch(), viewRegion: { xMin: 190, xMax: 270 } },
  ]);

  it("forward maps an in-region point right of the zone up by the growth", () => {
    // base 265 is in-view and right of the zone → rides the +30 tail growth.
    expectPt(remapPointForward({ x: 265, y: -33 }, groups), 295, -33);
  });

  it("inverse recovers that in-region tail point (was wrongly returning the display x)", () => {
    expectPt(remapPointInverse({ x: 295, y: -33 }, groups), 265, -33);
  });

  it("round-trips in-region points across zone + tail", () => {
    for (const p of [
      { x: 210, y: -5 },
      { x: 230, y: -5 },
      { x: 255, y: -5 },
      { x: 265, y: -5 },
    ]) {
      expectPt(remapPointInverse(remapPointForward(p, groups), groups), p.x, p.y);
    }
  });

  it("leaves a genuinely out-of-view point (far right) unchanged both ways", () => {
    expectPt(remapPointForward({ x: 400, y: -5 }, groups), 400, -5);
    expectPt(remapPointInverse({ x: 400, y: -5 }, groups), 400, -5);
  });
});

describe("remapPointInverse — crossBand round-trip", () => {
  // vertical zone internal [40,100] delta 30, cross-band on X [0,50].
  const groups = composeStretchGroups([
    { ...verticalStretch(), crossBand: { lo: 0, hi: 50 } },
  ]);

  it("round-trips an in-band point (scales)", () => {
    const p = { x: 25, y: -70 };
    expectPt(remapPointInverse(remapPointForward(p, groups), groups), p.x, p.y);
  });

  it("round-trips an out-of-band point (rides rigid)", () => {
    const p = { x: 100, y: -70 };
    expectPt(remapPointInverse(remapPointForward(p, groups), groups), p.x, p.y);
  });
});

describe("remapMarkupForward — whole markups", () => {
  const groups = composeStretchGroups([verticalStretch(), horizontalStretch()]);

  it("remaps both endpoints of a line, preserving type/id/sheet", () => {
    const line: Markup = {
      id: "mk1",
      sheetNumber: 2,
      type: "line",
      x1: 230,
      y1: -70,
      x2: 300,
      y2: -150,
    };
    const out = remapMarkupForward(line, groups);
    expect(out.type).toBe("line");
    expect(out.id).toBe("mk1");
    expect(out.sheetNumber).toBe(2);
    if (out.type !== "line") throw new Error("type changed");
    expectPt({ x: out.x1, y: out.y1 }, 245, -85);
    expectPt({ x: out.x2, y: out.y2 }, 330, -180);
  });

  it("remaps an arrow the same way (both endpoints)", () => {
    const arrow: Markup = {
      id: "a1",
      sheetNumber: 1,
      type: "arrow",
      x1: 230,
      y1: -70,
      x2: 300,
      y2: -150,
    };
    const out = remapMarkupForward(arrow, groups);
    if (out.type !== "arrow") throw new Error("type changed");
    expectPt({ x: out.x1, y: out.y1 }, 245, -85);
    expectPt({ x: out.x2, y: out.y2 }, 330, -180);
  });

  it("remaps a text anchor, preserving the text", () => {
    const text: Markup = {
      id: "t1",
      sheetNumber: 2,
      type: "text",
      x: 230,
      y: -70,
      text: "too small",
    };
    const out = remapMarkupForward(text, groups);
    if (out.type !== "text") throw new Error("type changed");
    expect(out.text).toBe("too small");
    expectPt({ x: out.x, y: out.y }, 245, -85);
  });

  it("is identity when there is no active stretch", () => {
    const text: Markup = { id: "t2", sheetNumber: 2, type: "text", x: 9, y: -9, text: "hi" };
    const out = remapMarkupForward(text, []) as typeof text;
    expect(out.x).toBe(9);
    expect(out.y).toBe(-9);
  });
});
