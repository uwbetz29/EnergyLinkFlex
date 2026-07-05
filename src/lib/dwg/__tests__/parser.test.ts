import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { parseDwg } from "../parser";
import type { DwgParseResult } from "../types";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const DWG_PATH = path.join(FIXTURE_DIR, "test-drawing.dwg");
const WASM_DIR = path.join(
  process.cwd(),
  "node_modules/@mlightcad/libredwg-web/wasm/"
);

describe("DWG Parser", () => {
  let result: DwgParseResult;

  beforeAll(async () => {
    const buffer = fs.readFileSync(DWG_PATH);
    result = await parseDwg(buffer.buffer, WASM_DIR);
  }, 30000); // WASM init can be slow

  describe("layers", () => {
    it("extracts all layers", () => {
      expect(result.layers.length).toBeGreaterThanOrEqual(10);
    });

    it("includes expected layer names", () => {
      const names = result.layers.map((l) => l.name);
      expect(names).toContain("0");
      expect(names).toContain("Border");
      expect(names).toContain("Visible (ANSI)");
      expect(names).toContain("Symbol (ANSI)");
    });

    it("has correct layer structure", () => {
      const layer0 = result.layers.find((l) => l.name === "0");
      expect(layer0).toBeDefined();
      expect(layer0!.handle).toBeDefined();
      expect(typeof layer0!.colorIndex).toBe("number");
    });
  });

  describe("blocks", () => {
    it("extracts user-defined blocks (no system blocks)", () => {
      expect(result.blocks.length).toBeGreaterThan(5);
      const names = result.blocks.map((b) => b.name);
      // System blocks should be filtered
      expect(names).not.toContain("*Model_Space");
      expect(names).not.toContain("*Paper_Space");
    });

    it("includes domain-specific blocks", () => {
      const names = result.blocks.map((b) => b.name);
      expect(names).toContain("CriticalFeature");
      expect(names).toContain("FLOW RIGHT");
      expect(names).toContain("Title Blocks ELC-GA");
    });

    it("counts entities within blocks", () => {
      const cf = result.blocks.find((b) => b.name === "CriticalFeature");
      expect(cf).toBeDefined();
      expect(cf!.entityCount).toBeGreaterThan(0);
      expect(cf!.entityTypes).toHaveProperty("LINE");
    });

    it("has basePoint for each block", () => {
      for (const block of result.blocks) {
        expect(block.basePoint).toBeDefined();
        expect(typeof block.basePoint.x).toBe("number");
        expect(typeof block.basePoint.y).toBe("number");
      }
    });
  });

  describe("inserts (block references)", () => {
    it("extracts INSERT entities", () => {
      expect(result.inserts.length).toBeGreaterThan(20);
    });

    it("has scale and rotation for each insert", () => {
      for (const ins of result.inserts) {
        expect(typeof ins.xScale).toBe("number");
        expect(typeof ins.yScale).toBe("number");
        expect(typeof ins.rotation).toBe("number");
        expect(ins.insertionPoint).toBeDefined();
      }
    });

    it("extracts attributes from inserts", () => {
      const titled = result.inserts.find(
        (i) => i.blockName === "Title Blocks ELC-GA"
      );
      expect(titled).toBeDefined();
      expect(titled!.attribs.length).toBeGreaterThan(5);
    });

    it("CriticalFeature inserts have nozzle ID attribs", () => {
      const nozzles = result.inserts.filter(
        (i) => i.blockName === "CriticalFeature"
      );
      expect(nozzles.length).toBeGreaterThan(10);

      // Each nozzle should have a tag like N1, N2, etc.
      for (const nozzle of nozzles) {
        expect(nozzle.attribs.length).toBeGreaterThan(0);
        expect(nozzle.attribs[0].tag).toMatch(/^N\d+$/);
      }
    });

    it("CENTER LINE inserts have component labels", () => {
      const centerlines = result.inserts.filter((i) =>
        i.blockName.startsWith("CENTER LINE")
      );
      expect(centerlines.length).toBeGreaterThan(0);

      const labels = centerlines.map((cl) => cl.attribs[0]?.tag).filter(Boolean);
      expect(labels).toContain("CATALYST FRAME");
      expect(labels).toContain("TURBINE OUTLET");
    });
  });

  describe("dimensions", () => {
    it("extracts dimension entities", () => {
      expect(result.dimensions.length).toBeGreaterThan(0);
    });

    it("dimensions have measurement values", () => {
      for (const dim of result.dimensions) {
        expect(typeof dim.measurement).toBe("number");
        expect(dim.defPoint).toBeDefined();
      }
    });
  });

  describe("title block", () => {
    it("extracts drawing number", () => {
      expect(result.titleBlock.drawingNumber).toBe("24081-CS1-0001");
    });

    it("extracts title text", () => {
      expect(result.titleBlock.title).toBeDefined();
      expect(result.titleBlock.title).toContain("TITAN PGM 130");
    });

    it("extracts date", () => {
      expect(result.titleBlock.date).toBeDefined();
      expect(result.titleBlock.date).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  describe("entity summary", () => {
    it("counts total entities", () => {
      expect(result.entitySummary.totalEntities).toBeGreaterThan(50000);
    });

    it("breaks down by type", () => {
      expect(result.entitySummary.typeCounts.LINE).toBeGreaterThan(10000);
      expect(result.entitySummary.typeCounts.SPLINE).toBeGreaterThan(1000);
      expect(result.entitySummary.typeCounts.INSERT).toBeGreaterThan(20);
    });
  });

  describe("SVG output", () => {
    it("generates SVG content", () => {
      expect(result.svg).toBeDefined();
      expect(result.svg.length).toBeGreaterThan(1000);
    });

    it("has valid SVG structure", () => {
      expect(result.svg).toContain("<svg");
      expect(result.svg).toContain("viewBox");
      expect(result.svg).toContain("</svg>");
    });
  });
});
