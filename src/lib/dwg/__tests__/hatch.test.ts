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

/**
 * BLOB v2 — the exploded HATCH / tessellated texture that survives the line pass
 * also arrives as thousands of sub-unit `<circle>`, `<ellipse>`, and `<path>`
 * (arc) elements. On white paper these render black and clump into residual
 * blobs on equipment tops. Extend dampenHatch to also gray SMALL circles /
 * ellipses / paths by injecting an inline `stroke` on the ELEMENT ITSELF.
 *
 * Element-inline (not group-recolor) is required because the real ellipse
 * structure is `<g stroke><g transform=rotate><ellipse/></g></g>` — the stroke
 * lives on the grandparent, and an element-level stroke overrides it while never
 * touching a sibling. "Size" per shape: circle = 2r, ellipse = 2·max(rx,ry),
 * path = bbox diagonal of the anchor endpoints parsed from `d`. Strict `< maxLen`.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const grayOn = (tag: string) =>
  new RegExp(`<${tag}\\b[^>]*\\bstroke="${esc(HATCH_COLOR)}"`);

describe("dampenHatch — circles / ellipses / paths (blob v2)", () => {
  it("grays a SMALL circle by injecting an inline stroke on the <circle>", () => {
    const svg = `<svg><g id="c" stroke="rgb(255,255,255)" fill="none"><circle cx="0" cy="0" r="0.05" /></g></svg>`; // diam 0.1 < 0.35
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("circle"));
  });

  it("leaves a LARGE circle untouched", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><circle cx="0" cy="0" r="5" /></g></svg>`; // diam 10
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("does NOT gray an element whose size is exactly maxLen (strict <)", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><circle r="0.175" /></g></svg>`; // diam 0.35 == maxLen
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("grays a small element even with NO enclosing stroke group (element-inline)", () => {
    const svg = `<svg><circle cx="0" cy="0" r="0.05" /></svg>`;
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("circle"));
  });

  it("grays a SMALL ellipse when the stroke lives on an ancestor <g> (nested rotate group)", () => {
    const svg = `<svg><g id="e" stroke="rgb(255,255,255)" fill="none"><g transform="rotate(90 1 1)"><ellipse cx="1" cy="1" rx="0.1" ry="0.08" /></g></g></svg>`; // 2*max=0.2 < 0.35
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("ellipse"));
  });

  it("leaves a LARGE ellipse untouched", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><g transform="rotate(90 1 1)"><ellipse cx="1" cy="1" rx="3" ry="2" /></g></g></svg>`;
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("grays a SMALL straight-segment path", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="M 0 0 L 0.1 0.1" /></g></svg>`; // diag ~0.14
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("path"));
  });

  it("grays a SMALL arc path (endpoint parsed past the A radii/rotation/flags)", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="M 0 0 A 0.05 0.05 0 1 1 0.1 0" /></g></svg>`; // endpoints (0,0)->(0.1,0), diag 0.1
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("path"));
  });

  it("accumulates RELATIVE path commands when measuring extent", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="M 1 1 l 0.1 0 l 0 0.1" /></g></svg>`; // spans 0.1x0.1
    const out = dampenHatch(svg);
    expect(out).toMatch(grayOn("path"));
  });

  it("leaves a LARGE path (long extent) untouched", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="M 0 0 L 50 0" /></g></svg>`;
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("leaves a multi-subpath path spanning a large area untouched", () => {
    // two tiny subpaths far apart is real geometry, not one hatch cell
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="M 0 0 L 0.1 0 M 20 20 L 20.1 20" /></g></svg>`;
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("leaves a path with an unparseable d untouched (safe default: never gray unknown geometry)", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><path d="" /></g><g stroke="rgb(255,255,255)"><path d="Z" /></g></svg>`;
    const out = dampenHatch(svg);
    expect(out).not.toContain(HATCH_COLOR);
  });

  it("replaces an existing inline stroke on a small element (no duplicate stroke attr)", () => {
    const svg = `<svg><circle r="0.05" stroke="rgb(255,255,255)" /></svg>`;
    const out = dampenHatch(svg);
    const circle = out.match(/<circle\b[^>]*>/)![0];
    expect((circle.match(/\bstroke=/g) || []).length).toBe(1);
    expect(circle).toContain(`stroke="${HATCH_COLOR}"`);
  });

  it("respects a custom maxLen and color for the new element types", () => {
    const svg = `<svg><g stroke="rgb(255,255,255)"><circle r="2" /></g></svg>`; // diam 4
    const out = dampenHatch(svg, { maxLen: 10, color: "rgb(180,180,180)" }); // 4 < 10 -> grayed
    expect(out).toMatch(/<circle\b[^>]*\bstroke="rgb\(180,180,180\)"/);
  });

  it("still dampens short LINES (regression) and preserves surrounding markup", () => {
    const svg = `<svg><rect x="0"/><g stroke="rgb(0,0,0)"><line x1="0" y1="0" x2="0.1" y2="0"/></g><circle r="0.05"/><text>hi</text></svg>`;
    const out = dampenHatch(svg);
    expect(out).toContain(`<rect x="0"/>`);
    expect(out).toContain(`<text>hi</text>`);
    // line group recolored AND circle element grayed -> two occurrences of the gray
    expect((out.match(new RegExp(esc(HATCH_COLOR), "g")) || []).length).toBe(2);
  });
});
