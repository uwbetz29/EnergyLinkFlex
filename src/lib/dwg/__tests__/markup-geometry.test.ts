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
