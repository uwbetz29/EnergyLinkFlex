import { describe, it, expect } from "vitest";
import { dampenHatch, HATCH_MAX_LEN, HATCH_COLOR } from "../hatch";

/**
 * dampenHatch(svg, opts?) recolors the STROKE of any `<g ...><line .../></g>`
 * group whose single line is shorter than `maxLen` (default HATCH_MAX_LEN) to
 * `color` (default HATCH_COLOR, a light gray). This tames exploded HATCH fill —
 * thousands of sub-unit segments that otherwise flood black at low zoom — while
 * leaving real geometry (long lines) untouched. Pure string transform.
 */

const g = (stroke: string, x1: number, y1: number, x2: number, y2: number, id = "1") =>
  `<g id="${id}" stroke="${stroke}" fill="none"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" /></g>`;

describe("dampenHatch", () => {
  it("recolors a SHORT-segment group's stroke to the gray color", () => {
    const svg = `<svg>${g("rgb(0,0,0)", 0, 0, 0.1, 0.1)}</svg>`; // len ~0.14 < 0.35
    const out = dampenHatch(svg);
    expect(out).toContain(`stroke="${HATCH_COLOR}"`);
    expect(out).not.toContain(`stroke="rgb(0,0,0)"`);
  });

  it("leaves a LONG-segment group untouched (real geometry)", () => {
    const svg = `<svg>${g("rgb(0,0,0)", 0, 0, 50, 0)}</svg>`; // len 50 >> 0.35
    const out = dampenHatch(svg);
    expect(out).toContain(`stroke="rgb(0,0,0)"`);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("handles many groups independently — only the short ones are dampened", () => {
    const svg = `<svg>${g("rgb(0,0,0)", 0, 0, 0.05, 0.05, "a")}${g("rgb(0,0,0)", 0, 0, 100, 0, "b")}${g("rgb(0,0,0)", 1, 1, 1.2, 1.1, "c")}</svg>`;
    const out = dampenHatch(svg);
    // groups a and c are short -> gray; b is long -> unchanged
    expect((out.match(new RegExp(HATCH_COLOR.replace(/[()]/g, "\\$&"), "g")) || []).length).toBe(2);
    expect(out).toContain(`stroke="rgb(0,0,0)"`); // b survives
  });

  it("leaves a group with NO line untouched", () => {
    const svg = `<svg><g id="x" stroke="rgb(0,0,0)" fill="none"><circle cx="0" cy="0" r="1"/></g></svg>`;
    const out = dampenHatch(svg);
    expect(out).toContain(`stroke="rgb(0,0,0)"`);
  });

  it("respects a custom maxLen and color", () => {
    const svg = `<svg>${g("rgb(0,0,0)", 0, 0, 5, 0)}</svg>`; // len 5
    const out = dampenHatch(svg, { maxLen: 10, color: "rgb(200,200,200)" });
    expect(out).toContain(`stroke="rgb(200,200,200)"`); // 5 < 10 -> dampened
  });

  it("is a pure transform that preserves surrounding markup", () => {
    const svg = `<svg><rect x="0"/>${g("rgb(0,0,0)", 0, 0, 0.1, 0)}<text>hi</text></svg>`;
    const out = dampenHatch(svg);
    expect(out).toContain("<rect x=\"0\"/>");
    expect(out).toContain("<text>hi</text>");
    expect(out).toContain(`<svg>`);
  });

  it("exports sane defaults", () => {
    expect(typeof HATCH_MAX_LEN).toBe("number");
    expect(HATCH_MAX_LEN).toBeGreaterThan(0);
    expect(HATCH_MAX_LEN).toBeLessThan(2);
    expect(typeof HATCH_COLOR).toBe("string");
  });
});
