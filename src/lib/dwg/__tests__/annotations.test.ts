// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isAnnotationBlockName, isAnnotationElement } from "../annotations";

const el = (svg: string) =>
  new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, "image/svg+xml"
  ).documentElement.firstElementChild as Element;

describe("annotation predicate", () => {
  it("recognizes annotation block names (render-strip parity)", () => {
    for (const n of ["CriticalFeature", "Borders ELC-D", "Title Blocks ELC-GA",
      "THIRD ANGLE PROJECTION", "2dTransSection0", "Datum Identifier1", "Datum Identifier7"])
      expect(isAnnotationBlockName(n)).toBe(true);
    expect(isAnnotationBlockName("#CriticalFeature")).toBe(true); // tolerates leading #
  });
  it("does NOT treat equipment or bare geometry as annotation block names", () => {
    expect(isAnnotationBlockName("SomeEquipmentBlock")).toBe(false);
  });
  it("classifies elements: dims, text, centerlines, symbols = annotation", () => {
    expect(isAnnotationElement(el(`<use href="#*D23"/>`))).toBe(true);
    expect(isAnnotationElement(el(`<g><use href="#*D23"/></g>`))).toBe(true);
    expect(isAnnotationElement(el(`<text x="1" y="2">50'-0"</text>`))).toBe(true);
    expect(isAnnotationElement(el(`<use href="#CENTER LINE_3"/>`))).toBe(true);
    expect(isAnnotationElement(el(`<use href="#Borders ELC-D"/>`))).toBe(true);
  });
  it("classifies raw geometry as equipment (not annotation)", () => {
    expect(isAnnotationElement(el(`<line x1="0" y1="0" x2="9" y2="9"/>`))).toBe(false);
    expect(isAnnotationElement(el(`<g><path d="M0 0 L9 9"/></g>`))).toBe(false);
  });
  it("treats a <g>-wrapped text label as annotation (real LibreDWG emits one entity per <g>)", () => {
    // Model_Space children are ALL <g> in the real drawing — bare <text> never appears,
    // so a label wrapped in a group must still be held rigid (never scaled/distorted).
    expect(isAnnotationElement(el(`<g><text x="1" y="2">10'-8"</text></g>`))).toBe(true);
    expect(isAnnotationElement(el(`<g><text>NEAR SIDE ELEVATION</text></g>`))).toBe(true);
  });
});
