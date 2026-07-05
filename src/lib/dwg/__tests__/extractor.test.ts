import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { parseDwg } from "../parser";
import {
  extractComponents,
  toEditorComponents,
  parseSvgViewBox,
} from "../extractor";
import type { DwgParseResult, DwgComponent } from "../types";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const DWG_PATH = path.join(FIXTURE_DIR, "test-drawing.dwg");
const WASM_DIR = path.join(
  process.cwd(),
  "node_modules/@mlightcad/libredwg-web/wasm/"
);

describe("Component Extractor", () => {
  let parseResult: DwgParseResult;
  let components: DwgComponent[];

  beforeAll(async () => {
    const buffer = fs.readFileSync(DWG_PATH);
    parseResult = await parseDwg(buffer.buffer, WASM_DIR);
    components = extractComponents(parseResult);
  }, 30000);

  describe("extractComponents", () => {
    it("extracts components from inserts", () => {
      expect(components.length).toBeGreaterThan(0);
    });

    it("filters out infrastructure blocks", () => {
      const blockNames = components.map((c) => c.blockName);
      expect(blockNames).not.toContain("Borders ELC-D");
      expect(blockNames).not.toContain("Title Blocks ELC-GA");
      expect(blockNames).not.toContain("THIRD ANGLE PROJECTION");
      expect(blockNames).not.toContain("Datum Identifier1");
    });

    it("keeps domain-relevant blocks", () => {
      const blockNames = components.map((c) => c.blockName);
      expect(blockNames).toContain("CriticalFeature");
      expect(blockNames.some((n) => n.startsWith("CENTER LINE"))).toBe(true);
    });

    it("generates unique IDs for each component", () => {
      const ids = components.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("labels nozzles with their ID", () => {
      const nozzles = components.filter((c) => c.blockName === "CriticalFeature");
      expect(nozzles.length).toBeGreaterThan(10);

      for (const nozzle of nozzles) {
        expect(nozzle.label).toMatch(/^Nozzle N\d+$/);
        expect(nozzle.nozzleId).toMatch(/^N\d+$/);
      }
    });

    it("labels centerlines with their component name", () => {
      const cls = components.filter((c) =>
        c.blockName.startsWith("CENTER LINE")
      );
      expect(cls.length).toBeGreaterThan(0);

      const labels = cls.map((c) => c.label);
      expect(labels).toContain("CATALYST FRAME");
      expect(labels).toContain("TURBINE OUTLET");
    });

    it("preserves position and scale", () => {
      for (const comp of components) {
        expect(typeof comp.position.x).toBe("number");
        expect(typeof comp.position.y).toBe("number");
        expect(typeof comp.scale.x).toBe("number");
        expect(comp.scale.x).toBeGreaterThan(0);
      }
    });

    it("builds attribs map", () => {
      const nozzle = components.find((c) => c.nozzleId === "N1");
      expect(nozzle).toBeDefined();
      expect(nozzle!.attribs).toBeDefined();
      expect(typeof nozzle!.attribs).toBe("object");
    });
  });

  describe("toEditorComponents", () => {
    it("converts DwgComponents to editor ComponentDefs", () => {
      const viewBox = parseSvgViewBox(parseResult.svg);
      const editorComps = toEditorComponents(components, viewBox);

      expect(Object.keys(editorComps).length).toBe(components.length);
    });

    it("assigns correct types based on block category", () => {
      const viewBox = parseSvgViewBox(parseResult.svg);
      const editorComps = toEditorComponents(components, viewBox);

      const nozzleComp = Object.values(editorComps).find(
        (c) => c.type === "nozzle"
      );
      expect(nozzleComp).toBeDefined();
      expect(nozzleComp!.color).toBe("#e74c3c");

      const clComp = Object.values(editorComps).find(
        (c) => c.type === "centerline"
      );
      expect(clComp).toBeDefined();
      expect(clComp!.color).toBe("#3498db");
    });

    it("generates bounding boxes as percentages", () => {
      const viewBox = parseSvgViewBox(parseResult.svg);
      const editorComps = toEditorComponents(components, viewBox);

      for (const comp of Object.values(editorComps)) {
        const [left, top, width, height] = comp.box;
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
      }
    });

    it("builds upstream/downstream relationships", () => {
      const viewBox = parseSvgViewBox(parseResult.svg);
      const editorComps = toEditorComponents(components, viewBox);

      // At least some components should have relationships
      const withRelationships = Object.values(editorComps).filter(
        (c) => c.downstream.length > 0 || c.upstream.length > 0
      );
      expect(withRelationships.length).toBeGreaterThan(0);
    });

    it("includes dims with position and scale", () => {
      const viewBox = parseSvgViewBox(parseResult.svg);
      const editorComps = toEditorComponents(components, viewBox);

      for (const comp of Object.values(editorComps)) {
        expect(comp.dims["X Position"]).toBeDefined();
        expect(comp.dims["Y Position"]).toBeDefined();
        expect(comp.dims["X Scale"]).toBeDefined();
      }
    });
  });

  describe("parseSvgViewBox", () => {
    it("parses viewBox from SVG string", () => {
      const svg = '<svg viewBox="10.5 -1332.14 1620 900.5" />';
      const vb = parseSvgViewBox(svg);
      expect(vb.minX).toBeCloseTo(10.5);
      expect(vb.minY).toBeCloseTo(-1332.14);
      expect(vb.width).toBeCloseTo(1620);
      expect(vb.height).toBeCloseTo(900.5);
    });

    it("returns defaults for missing viewBox", () => {
      const vb = parseSvgViewBox("<svg></svg>");
      expect(vb.width).toBe(1600);
      expect(vb.height).toBe(900);
    });

    it("parses real SVG from DWG output", () => {
      const vb = parseSvgViewBox(parseResult.svg);
      expect(vb.width).toBeGreaterThan(0);
      expect(vb.height).toBeGreaterThan(0);
    });
  });
});
