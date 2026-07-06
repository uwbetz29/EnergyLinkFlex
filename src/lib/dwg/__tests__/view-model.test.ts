// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeViewRegions, viewOf } from "../view-model";
import { findModelSpace } from "../svg-stretch";
import { makeTwoViewSvg } from "./fixtures";

const ms = (svgStr: string) =>
  findModelSpace(
    new DOMParser().parseFromString(svgStr, "image/svg+xml").documentElement as unknown as SVGSVGElement
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
    const body = [100, 150, 200, 250, 300]
      .flatMap((x) => [400, 500, 600, 700].map((y) => eq(x, y)))
      .join("");
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
