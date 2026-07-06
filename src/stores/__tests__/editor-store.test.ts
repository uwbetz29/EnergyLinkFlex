import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editor-store";
import type { DwgComponent, DwgLayer } from "@/lib/dwg/types";

describe("Editor Store — DWG support", () => {
  beforeEach(() => {
    // Reset store between tests
    useEditorStore.setState({
      projectId: null,
      projectName: null,
      drawingType: "pdf",
      pdfUrl: null,
      svgUrl: null,
      dwgComponents: [],
      dwgLayers: [],
      dwgMetadata: null,
      visibleLayers: new Set(),
      components: {},
      selectedId: null,
      showOverlays: false,
      originals: {},
      changeCount: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  describe("updateDim guards", () => {
    it("ignores an update to a dim the component does not have (AI phantom dimKey)", () => {
      useEditorStore.setState({
        components: {
          c1: { id: "c1", name: "Silencer", type: "flow", dims: { Height: "10'-0\"" } } as unknown as never,
        },
      });
      useEditorStore.getState().updateDim("c1", "Bogus Dim", "99'-0\"");
      const s = useEditorStore.getState();
      expect(s.changeCount).toBe(0);
      expect(s.originals.c1).toBeUndefined();
      expect((s.components.c1 as { dims: Record<string, string> }).dims["Bogus Dim"]).toBeUndefined();
      // a real dim on the same component still updates
      useEditorStore.getState().updateDim("c1", "Height", "12'-0\"");
      expect((useEditorStore.getState().components.c1 as { dims: Record<string, string> }).dims.Height).toBe("12'-0\"");
    });
  });

  describe("setDrawingType", () => {
    it("sets drawing type to dwg", () => {
      useEditorStore.getState().setDrawingType("dwg");
      expect(useEditorStore.getState().drawingType).toBe("dwg");
    });

    it("sets drawing type to pdf", () => {
      useEditorStore.getState().setDrawingType("pdf");
      expect(useEditorStore.getState().drawingType).toBe("pdf");
    });
  });

  describe("setSvgUrl", () => {
    it("stores SVG URL", () => {
      useEditorStore.getState().setSvgUrl("https://blob.example.com/test.svg");
      expect(useEditorStore.getState().svgUrl).toBe(
        "https://blob.example.com/test.svg"
      );
    });
  });

  describe("setDwgData", () => {
    const mockComponents: DwgComponent[] = [
      {
        id: "dwg-1",
        blockName: "CriticalFeature",
        label: "Nozzle N1",
        nozzleId: "N1",
        position: { x: 100, y: 200, z: 0 },
        scale: { x: 36, y: 36, z: 36 },
        rotation: 0,
        layer: "0",
        attribs: { N1: "N1" },
      },
      {
        id: "dwg-2",
        blockName: "CENTER LINE",
        label: "CATALYST FRAME",
        nozzleId: null,
        position: { x: 369, y: 551, z: 0 },
        scale: { x: 36, y: 36, z: 36 },
        rotation: 1.57,
        layer: "0",
        attribs: { "CATALYST FRAME": "CATALYST FRAME" },
      },
    ];

    const mockLayers: DwgLayer[] = [
      {
        name: "0",
        handle: "1",
        colorIndex: 7,
        color: "#ffffff",
        isFrozen: false,
        isOff: false,
        isLocked: false,
      },
      {
        name: "Symbol (ANSI)",
        handle: "2",
        colorIndex: 1,
        color: "#ff0000",
        isFrozen: false,
        isOff: false,
        isLocked: false,
      },
    ];

    it("stores components and layers", () => {
      useEditorStore.getState().setDwgData(mockComponents, mockLayers, null);

      const state = useEditorStore.getState();
      expect(state.dwgComponents).toHaveLength(2);
      expect(state.dwgLayers).toHaveLength(2);
    });

    it("initializes all layers as visible", () => {
      useEditorStore.getState().setDwgData(mockComponents, mockLayers, null);

      const state = useEditorStore.getState();
      expect(state.visibleLayers.has("0")).toBe(true);
      expect(state.visibleLayers.has("Symbol (ANSI)")).toBe(true);
    });

    it("stores metadata", () => {
      const metadata = {
        drawingNumber: "24081-CS1-0001",
        title: "TITAN PGM 130 SCR/CO CATALYST SYSTEM",
        subtitle: null,
        customer: "MOBILE ENERGY RENTALS LLC",
        company: "SOLARIS ENERGY INFRASTRUCTURE",
        drawnBy: "AM",
        checkedBy: "ATM",
        date: "4/12/2025",
        revision: "0",
        scale: null,
      };

      useEditorStore.getState().setDwgData(mockComponents, mockLayers, metadata);

      expect(useEditorStore.getState().dwgMetadata).toEqual(metadata);
    });
  });

  describe("toggleLayer", () => {
    it("removes layer from visible set", () => {
      useEditorStore.setState({
        visibleLayers: new Set(["0", "Symbol (ANSI)", "Border"]),
      });

      useEditorStore.getState().toggleLayer("Border");

      const visible = useEditorStore.getState().visibleLayers;
      expect(visible.has("Border")).toBe(false);
      expect(visible.has("0")).toBe(true);
      expect(visible.has("Symbol (ANSI)")).toBe(true);
    });

    it("adds layer back to visible set", () => {
      useEditorStore.setState({
        visibleLayers: new Set(["0"]),
      });

      useEditorStore.getState().toggleLayer("Border");

      expect(useEditorStore.getState().visibleLayers.has("Border")).toBe(true);
    });
  });

  describe("existing PDF functionality preserved", () => {
    it("setPdfUrl still works", () => {
      useEditorStore.getState().setPdfUrl("https://example.com/test.pdf");
      expect(useEditorStore.getState().pdfUrl).toBe(
        "https://example.com/test.pdf"
      );
    });

    it("zoom and pan still work", () => {
      useEditorStore.getState().setZoom(2.5);
      expect(useEditorStore.getState().zoom).toBe(2.5);

      useEditorStore.getState().setPan(100, -50);
      expect(useEditorStore.getState().panX).toBe(100);
      expect(useEditorStore.getState().panY).toBe(-50);
    });

    it("zoom is clamped to valid range", () => {
      useEditorStore.getState().setZoom(0.01);
      expect(useEditorStore.getState().zoom).toBe(0.1);

      useEditorStore.getState().setZoom(10);
      expect(useEditorStore.getState().zoom).toBe(5);
    });

    it("component selection still works", () => {
      useEditorStore.getState().select("comp-1");
      expect(useEditorStore.getState().selectedId).toBe("comp-1");

      useEditorStore.getState().select(null);
      expect(useEditorStore.getState().selectedId).toBeNull();
    });
  });
});
