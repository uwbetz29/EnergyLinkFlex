import { create } from "zustand";
import type { DwgComponent, DwgLayer, DwgTitleBlock, DwgSheet } from "@/lib/dwg/types";
import type { SheetType } from "@/lib/dwg/sheet-type";
import { parseDimInches, formatDimInches } from "@/lib/dwg/svg-stretch";

/* ─── Types ─── */

export interface ComponentDef {
  id: string;
  name: string;
  type: string;
  color: string;
  icon: string;
  /** Bounding box on drawing as % of page: [left, top, width, height] */
  box: [number, number, number, number];
  /** Editable dimensions keyed by label */
  dims: Record<string, string>;
  /** Map dim key → SVG *D## block ID for stretch geometry lookup */
  dimBlocks: Record<string, string>;
  /** Which dim key is the "main" one for quick-adjust */
  mainDim: string;
  constraints: { label: string; value: string; ok: boolean }[];
  /** IDs of downstream components that shift when this resizes */
  downstream: string[];
  upstream: string[];
  notes: string;
}

export type Stage = "import" | "configure" | "review" | "export";
export type DrawingType = "pdf" | "dwg";

export interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface EditorState {
  /* Project */
  projectId: string | null;
  projectName: string | null;

  /* Drawing */
  drawingType: DrawingType;
  pdfUrl: string | null;
  svgUrl: string | null;
  currentSheet: number;
  totalSheets: number;

  /* Multi-sheet DWG */
  sheets: DwgSheet[];
  activeSheetIndex: number;

  /** Sheet-type classification ("GA" | "PID") for the active sheet; drives resize-UI gating. */
  sheetType: SheetType;
  setSheetType: (t: SheetType) => void;

  /* DWG data */
  dwgComponents: DwgComponent[];
  dwgLayers: DwgLayer[];
  dwgMetadata: DwgTitleBlock | null;
  visibleLayers: Set<string>;

  /* SVG viewBox for coordinate mapping */
  svgViewBox: SvgViewBox | null;

  /* Components */
  components: Record<string, ComponentDef>;
  selectedId: string | null;
  showOverlays: boolean;
  showDiff: boolean;
  /** Component IDs hidden from sidebar & overlays */
  hiddenComponents: Set<string>;

  /* Changes tracking: componentId → { dimKey → originalValue } */
  originals: Record<string, Record<string, string>>;
  changeCount: number;

  /** Incremented on every dim change to trigger SVG re-stretch */
  stretchVersion: number;

  /** User-facing warning when a stretch was rolled back (drawing left unchanged) */
  stretchWarning: string | null;
  setStretchWarning: (msg: string | null) => void;

  /* Undo / Redo */
  history: { compId: string; dimKey: string; prevValue: string; newValue: string }[];
  historyIndex: number;
  undo: () => void;
  redo: () => void;

  /* Stage */
  stage: Stage;

  /* Zoom / Pan */
  zoom: number;
  panX: number;
  panY: number;

  /* Actions */
  setProject: (id: string, name: string) => void;
  setDrawingType: (type: DrawingType) => void;
  setPdfUrl: (url: string) => void;
  setSvgUrl: (url: string) => void;
  setSheet: (n: number) => void;
  setComponents: (comps: Record<string, ComponentDef>) => void;
  setDwgData: (
    components: DwgComponent[],
    layers: DwgLayer[],
    metadata: DwgTitleBlock | null
  ) => void;
  setSvgViewBox: (vb: SvgViewBox) => void;
  toggleLayer: (layerName: string) => void;
  select: (id: string | null) => void;
  toggleOverlays: () => void;
  toggleDiff: () => void;
  setStage: (s: Stage) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  updateDim: (compId: string, dimKey: string, value: string) => void;
  quickAdjust: (compId: string, deltaFt: number) => void;
  resetComp: (compId: string) => void;
  toggleComponentVisibility: (compId: string) => void;
  showAllComponents: () => void;

  /* Component management */
  addComponent: (comp: ComponentDef) => void;
  removeComponent: (id: string) => void;

  /* Multi-sheet actions */
  setSheets: (sheets: DwgSheet[]) => void;
  setActiveSheet: (index: number) => void;
}

/* ─── Helpers ─── */
/* Dimension parsing now uses parseDimInches/formatDimInches from svg-stretch */

/* ─── Store ─── */

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  projectName: null,

  drawingType: "pdf" as DrawingType,
  pdfUrl: null,
  svgUrl: null,
  currentSheet: 2,
  totalSheets: 3,

  sheets: [],
  activeSheetIndex: 0,

  sheetType: "GA" as SheetType,

  dwgComponents: [],
  dwgLayers: [],
  dwgMetadata: null,
  visibleLayers: new Set<string>(),

  svgViewBox: null,

  components: {},
  selectedId: null,
  showOverlays: false,
  showDiff: false,
  hiddenComponents: new Set<string>(),

  originals: {},
  changeCount: 0,
  stretchVersion: 0,
  stretchWarning: null,

  history: [],
  historyIndex: -1,

  stage: "configure",

  zoom: 1,
  panX: 0,
  panY: 0,


  setProject: (id, name) => set({ projectId: id, projectName: name }),
  setDrawingType: (type) => set({ drawingType: type }),
  setPdfUrl: (url) => set({ pdfUrl: url }),
  setSvgUrl: (url) => set({ svgUrl: url }),
  setSheet: (n) => set({ currentSheet: n }),
  setSheetType: (t) => set({ sheetType: t }),
  setComponents: (comps) => set({ components: comps }),
  setDwgData: (components, layers, metadata) => {
    // Auto-hide non-essential layers for cleaner sales view
    const hiddenByDefault = new Set([
      "Hatch (ANSI)",
      "Hidden (ANSI)",
      "Border",
      "Border (ANSI)",
    ]);
    const visible = new Set(
      layers
        .filter((l) => !hiddenByDefault.has(l.name))
        .map((l) => l.name)
    );
    set({
      dwgComponents: components,
      dwgLayers: layers,
      dwgMetadata: metadata,
      visibleLayers: visible,
    });
  },
  setSvgViewBox: (vb) => set({ svgViewBox: vb }),
  setStretchWarning: (msg) => set({ stretchWarning: msg }),
  toggleLayer: (layerName) =>
    set((s) => {
      const next = new Set(s.visibleLayers);
      if (next.has(layerName)) {
        next.delete(layerName);
      } else {
        next.add(layerName);
      }
      return { visibleLayers: next };
    }),

  select: (id) => set({ selectedId: id }),
  toggleOverlays: () => set((s) => ({ showOverlays: !s.showOverlays })),
  toggleDiff: () => set((s) => ({ showDiff: !s.showDiff })),
  setStage: (s) => set({ stage: s }),
  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(5, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),

  updateDim: (compId, dimKey, value) => {
    const { components, originals } = get();
    const comp = components[compId];
    if (!comp) return;
    // Ignore updates to a dim the component doesn't have — the AI cascade can
    // return a phantom dimKey, which would otherwise record `undefined` as the
    // "original" and crash the change-info/stretch paths (parseDimInches).
    if (!(dimKey in comp.dims)) return;

    // Truncate redo history and add new entry
    const prevValue = comp.dims[dimKey];
    if (prevValue === value) return; // No change
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push({ compId, dimKey, prevValue, newValue: value });

    // Save original if first edit
    const compOrig = originals[compId] ?? {};
    if (!(dimKey in compOrig)) {
      compOrig[dimKey] = comp.dims[dimKey];
    }

    const newComps = {
      ...components,
      [compId]: {
        ...comp,
        dims: { ...comp.dims, [dimKey]: value },
      },
    };

    // Count total changes
    const newOrig = { ...originals, [compId]: compOrig };
    let count = 0;
    for (const cid of Object.keys(newOrig)) {
      for (const dk of Object.keys(newOrig[cid])) {
        if (newComps[cid]?.dims[dk] !== newOrig[cid][dk]) count++;
      }
    }

    set({
      components: newComps,
      originals: newOrig,
      changeCount: count,
      stretchVersion: get().stretchVersion + 1,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  quickAdjust: (compId, deltaFt) => {
    const { components } = get();
    const comp = components[compId];
    if (!comp) return;
    const key = comp.mainDim;
    const current = comp.dims[key];
    const inches = parseDimInches(current);
    if (inches === null || inches === 0) {
      // Try as plain number (DWG scale units)
      const num = parseFloat(current);
      if (!isNaN(num)) {
        const newVal = Math.max(1, num + deltaFt);
        get().updateDim(compId, key, String(Math.round(newVal * 100) / 100));
        return;
      }
      return;
    }
    const newInches = Math.max(12, inches + deltaFt * 12);
    get().updateDim(compId, key, formatDimInches(newInches));
  },

  undo: () => {
    const { history, historyIndex, components, originals } = get();
    if (historyIndex < 0) return;

    const entry = history[historyIndex];
    const comp = components[entry.compId];
    if (!comp) return;

    const newComps = {
      ...components,
      [entry.compId]: {
        ...comp,
        dims: { ...comp.dims, [entry.dimKey]: entry.prevValue },
      },
    };

    // Recount changes
    let count = 0;
    for (const cid of Object.keys(originals)) {
      for (const dk of Object.keys(originals[cid])) {
        if (newComps[cid]?.dims[dk] !== originals[cid][dk]) count++;
      }
    }

    set({
      components: newComps,
      historyIndex: historyIndex - 1,
      changeCount: count,
      stretchVersion: get().stretchVersion + 1,
    });
  },

  redo: () => {
    const { history, historyIndex, components, originals } = get();
    if (historyIndex >= history.length - 1) return;

    const entry = history[historyIndex + 1];
    const comp = components[entry.compId];
    if (!comp) return;

    const newComps = {
      ...components,
      [entry.compId]: {
        ...comp,
        dims: { ...comp.dims, [entry.dimKey]: entry.newValue },
      },
    };

    let count = 0;
    for (const cid of Object.keys(originals)) {
      for (const dk of Object.keys(originals[cid])) {
        if (newComps[cid]?.dims[dk] !== originals[cid][dk]) count++;
      }
    }

    set({
      components: newComps,
      historyIndex: historyIndex + 1,
      changeCount: count,
      stretchVersion: get().stretchVersion + 1,
    });
  },

  resetComp: (compId) => {
    const { components, originals } = get();
    const comp = components[compId];
    const compOrig = originals[compId];
    if (!comp || !compOrig) return;

    const restoredDims = { ...comp.dims };
    for (const [k, v] of Object.entries(compOrig)) {
      restoredDims[k] = v;
    }

    const newOrig = { ...originals };
    delete newOrig[compId];

    let count = 0;
    for (const cid of Object.keys(newOrig)) {
      for (const dk of Object.keys(newOrig[cid])) {
        if (components[cid]?.dims[dk] !== newOrig[cid][dk]) count++;
      }
    }

    set({
      components: {
        ...components,
        [compId]: { ...comp, dims: restoredDims },
      },
      originals: newOrig,
      changeCount: count,
    });
  },

  toggleComponentVisibility: (compId) => {
    const { hiddenComponents } = get();
    const next = new Set(hiddenComponents);
    if (next.has(compId)) {
      next.delete(compId);
    } else {
      next.add(compId);
    }
    set({ hiddenComponents: next });
  },

  showAllComponents: () => {
    set({ hiddenComponents: new Set<string>() });
  },

  /* ─── Component management ─── */

  addComponent: (comp) =>
    set((s) => ({ components: { ...s.components, [comp.id]: comp } })),

  removeComponent: (id) =>
    set((s) => {
      const next = { ...s.components };
      delete next[id];
      return { components: next, selectedId: s.selectedId === id ? null : s.selectedId };
    }),

  /* ─── Multi-sheet actions ─── */

  setSheets: (sheets) =>
    set({ sheets, activeSheetIndex: 0, totalSheets: sheets.length }),

  setActiveSheet: (index) => {
    const { sheets } = get();
    if (index < 0 || index >= sheets.length) return;
    const sheet = sheets[index];

    // Auto-hide non-essential layers for cleaner sales view
    const hiddenByDefault = new Set([
      "Hatch (ANSI)",
      "Hidden (ANSI)",
      "Border",
      "Border (ANSI)",
    ]);
    const visible = new Set(
      sheet.layers
        .filter((l) => !hiddenByDefault.has(l.name))
        .map((l) => l.name)
    );

    set({
      activeSheetIndex: index,
      currentSheet: sheet.sheetNumber,
      svgUrl: sheet.svgUrl,
      dwgComponents: sheet.components,
      dwgLayers: sheet.layers,
      dwgMetadata: sheet.metadata ?? null,
      visibleLayers: visible,
      sheetType: sheet.sheetType ?? "GA",
    });
  },
}));
