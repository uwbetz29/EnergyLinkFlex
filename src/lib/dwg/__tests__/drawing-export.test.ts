import { describe, it, expect } from "vitest";
import {
  computeExportSize,
  buildTitleBlock,
  exportTimestamp,
  formatDisplayDate,
  slugify,
  exportFilename,
} from "../drawing-export";
import type { DwgTitleBlock } from "../types";

const FULL_META: DwgTitleBlock = {
  drawingNumber: "24081-CS1-0001",
  title: "General Arrangement — SCR/CO System",
  subtitle: "Sheet 2",
  customer: "Acme Power LLC",
  company: "Linder Industrial",
  drawnBy: "JB",
  checkedBy: "MK",
  date: "2024-11-02",
  revision: "C",
  scale: '1/4" = 1\'',
};

describe("computeExportSize", () => {
  it("caps the longer (landscape) side at maxPx and preserves aspect", () => {
    const s = computeExportSize({ width: 2000, height: 1000 }, 3000);
    expect(s).toEqual({ w: 3000, h: 1500 });
  });

  it("caps the longer (portrait) side at maxPx and preserves aspect", () => {
    const s = computeExportSize({ width: 1000, height: 2000 }, 3000);
    expect(s).toEqual({ w: 1500, h: 3000 });
  });

  it("handles a square viewBox", () => {
    const s = computeExportSize({ width: 500, height: 500 }, 2400);
    expect(s).toEqual({ w: 2400, h: 2400 });
  });

  it("falls back to a square when the viewBox is degenerate (zero/NaN)", () => {
    expect(computeExportSize({ width: 0, height: 0 }, 3000)).toEqual({
      w: 3000,
      h: 3000,
    });
    expect(
      computeExportSize({ width: NaN, height: 100 }, 3000)
    ).toEqual({ w: 3000, h: 3000 });
  });
});

describe("buildTitleBlock", () => {
  it("maps all fields when metadata is fully populated", () => {
    const tb = buildTitleBlock(FULL_META, "My Project", "2026-07-08");
    expect(tb.drawingNumber).toBe("24081-CS1-0001");
    expect(tb.title).toBe("General Arrangement — SCR/CO System");
    expect(tb.customer).toBe("Acme Power LLC");
    expect(tb.company).toBe("Linder Industrial");
    expect(tb.scale).toBe('1/4" = 1\'');
    expect(tb.revision).toBe("C");
    expect(tb.date).toBe("2026-07-08");
    expect(tb.project).toBe("My Project");
  });

  it("falls back to project name for the title and N/A for missing fields", () => {
    const tb = buildTitleBlock(null, "Bid 42", "2026-07-08");
    expect(tb.title).toBe("Bid 42");
    expect(tb.drawingNumber).toBe("N/A");
    expect(tb.customer).toBe("N/A");
    expect(tb.company).toBe("N/A");
    expect(tb.scale).toBe("N/A");
    expect(tb.revision).toBe("N/A");
    expect(tb.project).toBe("Bid 42");
  });

  it("treats blank/whitespace-only metadata strings as missing", () => {
    const blank: DwgTitleBlock = {
      ...FULL_META,
      drawingNumber: "   ",
      customer: "",
      title: null,
      scale: "  ",
    };
    const tb = buildTitleBlock(blank, "Fallback Proj", "2026-07-08");
    expect(tb.drawingNumber).toBe("N/A");
    expect(tb.customer).toBe("N/A");
    expect(tb.title).toBe("Fallback Proj");
    expect(tb.scale).toBe("N/A");
  });

  it("uses 'Untitled' when neither title nor project name is available", () => {
    const tb = buildTitleBlock(null, null, "2026-07-08");
    expect(tb.title).toBe("Untitled");
    expect(tb.project).toBe("N/A");
  });
});

describe("exportTimestamp", () => {
  it("formats a date as YYYYMMDD-HHMM (zero-padded, local time)", () => {
    // Month is 0-indexed: 6 = July. 09:05 → padded.
    expect(exportTimestamp(new Date(2026, 6, 8, 9, 5))).toBe("20260708-0905");
    expect(exportTimestamp(new Date(2026, 11, 31, 23, 59))).toBe(
      "20261231-2359"
    );
  });
});

describe("formatDisplayDate", () => {
  it("formats a readable YYYY-MM-DD calendar date (not a machine timestamp)", () => {
    expect(formatDisplayDate(new Date(2026, 6, 8, 9, 5))).toBe("2026-07-08");
    expect(formatDisplayDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("slugify", () => {
  it("lowercases, keeps alnum, and collapses the rest to single hyphens", () => {
    expect(slugify("24081-CS1-0001")).toBe("24081-cs1-0001");
    expect(slugify('1/4" GA  Sheet 2')).toBe("1-4-ga-sheet-2");
    expect(slugify("  trailing / leading  ")).toBe("trailing-leading");
  });

  it("falls back to 'drawing' for an empty or symbol-only base", () => {
    expect(slugify("")).toBe("drawing");
    expect(slugify("///")).toBe("drawing");
  });
});

describe("exportFilename", () => {
  it("composes slug + timestamp + extension", () => {
    const name = exportFilename(
      "24081-CS1-0001",
      new Date(2026, 6, 8, 9, 5),
      "pdf"
    );
    expect(name).toBe("24081-cs1-0001_20260708-0905.pdf");
  });
});
