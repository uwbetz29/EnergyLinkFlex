import { describe, it, expect } from "vitest";
import { classifySheetType, sheetTypeLabel, MIN_GA_DIMS } from "../sheet-type";

const base = { dimensions: [], entitySummary: { totalEntities: 0, typeCounts: {} } };
const withDims = (n: number) => ({ ...base, dimensions: Array.from({ length: n }, (_, i) => ({ handle: String(i) })) });

describe("classifySheetType", () => {
  it("GA when it has >= MIN_GA_DIMS dimension entities", () => {
    expect(classifySheetType(withDims(40) as never)).toBe("GA");
    expect(classifySheetType(withDims(MIN_GA_DIMS) as never)).toBe("GA");
  });
  it("PID when it has no dimension entities", () => {
    expect(classifySheetType(base as never)).toBe("PID");
  });
  it("PID for a schematic (0 dims, HATCH/ACAD_TABLE/VIEWPORT present)", () => {
    const pid = { dimensions: [], entitySummary: { totalEntities: 300, typeCounts: { INSERT: 302, HATCH: 12, ACAD_TABLE: 1, VIEWPORT: 2 } } };
    expect(classifySheetType(pid as never)).toBe("PID");
  });
  it("label distinguishes P&ID (schematic markers) from generic non-resizable", () => {
    const pid = { dimensions: [], entitySummary: { totalEntities: 300, typeCounts: { HATCH: 12, VIEWPORT: 2 } } };
    expect(sheetTypeLabel(pid as never)).toMatch(/P&ID/i);
    expect(sheetTypeLabel(base as never)).toMatch(/no dimensions/i);
    expect(sheetTypeLabel(withDims(40) as never)).toBe("");
  });
});
