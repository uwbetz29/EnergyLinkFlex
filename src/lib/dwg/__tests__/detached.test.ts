// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { detectDetachedAssemblies, CONF_MIN } from "../detached";
import { findModelSpace } from "../svg-stretch";
import { makeDetachedSvg, makeNarrowDetachedSvg, makeDenseSvg } from "./fixtures";

const ms = (svg: string) =>
  findModelSpace(
    new DOMParser().parseFromString(svg, "image/svg+xml")
      .documentElement as unknown as SVGSVGElement
  )!;

describe("detectDetachedAssemblies (U3 gap detection)", () => {
  it("finds a compact cluster across a WIDE corridor, at the cluster's bbox, high confidence", () => {
    const out = detectDetachedAssemblies(ms(makeDetachedSvg()));
    expect(out.length).toBeGreaterThanOrEqual(1);
    const best = out[0];
    expect(best.confidence).toBeGreaterThanOrEqual(CONF_MIN);
    // the detached side is the skid (Y ~[150,165]), NOT the main mass (Y ~[30,50])
    expect(best.bbox.yMin).toBeGreaterThan(100);
    expect(best.bbox.yMax).toBeLessThan(200);
  });

  it("a NARROW corridor yields a candidate BELOW CONF_MIN (caller would WARN)", () => {
    const out = detectDetachedAssemblies(ms(makeNarrowDetachedSvg()));
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].confidence).toBeLessThan(CONF_MIN);
  });

  it("returns [] when there is no corridor (dense uniform grid)", () => {
    expect(detectDetachedAssemblies(ms(makeDenseSvg()))).toEqual([]);
  });
});
