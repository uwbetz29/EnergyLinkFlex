// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getDimBlockBounds, dimBlockBox2D } from "../dim-geometry";
import { makeTwoViewSvg } from "./fixtures";

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;

// Behaviour-preservation goldens for the pure helpers extracted from
// svg-drawing-canvas.tsx. Expected values are hand-computed: block-local line
// coords + the referencing <use> x/y offset (how the originals compute).
describe("dim-geometry (extracted pure helpers)", () => {
  const svg = parse(makeTwoViewSvg());

  it("getDimBlockBounds vertical = line Y extent + <use> Y offset", () => {
    // *D1: line y[500,600] + use y=550
    expect(getDimBlockBounds(svg, "*D1", "vertical")).toEqual({ min: 1050, max: 1150 });
    // *D3: line y[291,891] + use y=591
    expect(getDimBlockBounds(svg, "*D3", "vertical")).toEqual({ min: 882, max: 1482 });
  });

  it("getDimBlockBounds returns null when the axis is degenerate (min===max)", () => {
    // *D1 is a vertical dim (x1===x2) → horizontal bounds collapse
    expect(getDimBlockBounds(svg, "*D1", "horizontal")).toBeNull();
  });

  it("getDimBlockBounds returns null for a missing block", () => {
    expect(getDimBlockBounds(svg, "*NOPE", "vertical")).toBeNull();
  });

  it("dimBlockBox2D returns the full 2D bbox incl. <use> offset", () => {
    // *D2: line x=1480 (+use 1480 → 2960), y[291,546] + use 419 → [710,965]
    expect(dimBlockBox2D(svg, "*D2")).toEqual({
      xMin: 2960,
      xMax: 2960,
      yMin: 710,
      yMax: 965,
    });
  });
});
