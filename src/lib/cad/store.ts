// Zustand store for CAD viewer state management
import { create } from "zustand";
import type {
  ParsedDrawing,
  ParsedEntity,
  ScaleMode,
  ScaleOperation,
  CADComponent,
  ParametricDimension,
  DimensionModification,
  CascadeSuggestion,
} from "@/types/cad";
import { parseDXF } from "./dxf-parse";
import { detectComponents } from "./component-detector";
import { scaleComponent, type ScaleParams } from "./geometry-scaler";
import { linkDimensions, formatImperialDimension } from "./dimension-link";
import { modifyDimension, analyzeCascade, shiftDimension, type ModifyDimensionParams } from "./dimension-modify";
import { findComponentForDimension } from "./find-component";
import { applyTransforms, validateTransforms } from "./apply-transforms";
import type { AIResizeResponse } from "@/types/ai-resize";
import type { CompositeAnalysis } from "@/types/composite";
import type { ComponentGraph } from "@/types/component-recognition";
import { propagateDimensionChange } from "./cross-page-propagate";
import { summarizeGeometry } from "./geometry-summarizer";
import { buildConnectivityGraph, analyzeConnectedCascade } from "./connectivity-graph";
import type { Constraint, ConstraintViolation } from "@/types/constraints";

/** A snapshot of drawing + dimensions for undo/redo */
interface DrawingSnapshot {
  drawing: ParsedDrawing;
  dimensions: ParametricDimension[];
}

/** A PDF entity tagged with its page number */
type PDFPageEntity = ParsedEntity & { _page: number };

/** A tab represents an open file — either a read-only source or a working copy */
export interface FileTab {
  id: string;
  /** The original drawing ID from the project store */
  sourceDrawingId: string;
  /** Display name shown on the tab */
  label: string;
  /** Original file name */
  fileName: string;
  /** Whether this is a read-only view of the source or an editable working copy */
  type: "source" | "working";
  /** The DXF content (original for source, current state for working) */
  dxfContent: string;
  /** For PDFs — the data URL */
  isPdf: boolean;
  /** Whether the working copy has unsaved changes */
  isDirty: boolean;
}

interface CADStore {
  // Drawing state
  drawing: ParsedDrawing | null;
  isLoading: boolean;
  error: string | null;

  // Tab state
  tabs: FileTab[];
  activeTabId: string | null;

  // Selection state
  selectedComponentId: string | null;
  hoveredComponentId: string | null;

  // Parametric dimensions
  dimensions: ParametricDimension[];
  selectedDimensionId: string | null;

  // Settings
  scaleMode: ScaleMode;
  layerVisibility: Record<string, boolean>;

  // PDF page navigation
  pdfPageCount: number;
  pdfCurrentPage: number;
  /** All entities from all pages, Y-flipped per-page, with _page tag */
  pdfAllEntities: PDFPageEntity[];
  /** Page dimensions from the PDF */
  pdfPages: Array<{ width: number; height: number }>;
  /** Original file name for the PDF (used to detect same-file page switches) */
  pdfFileName: string | null;

  // AI resize state
  isResizing: boolean;
  resizeError: string | null;
  lastResizeReasoning: string | null;
  /** Last successful modification, used to trigger flash highlight */
  lastModification: DimensionModification | null;

  // Composite analysis state
  compositeAnalysis: CompositeAnalysis | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  /** Dimensions for ALL pages, keyed by page source (e.g., "pdf:1", "dwg:0") */
  allPageDimensions: Map<string, ParametricDimension[]>;

  // Cascade suggestions (after a dimension resize)
  cascadeSuggestions: CascadeSuggestion[];

  // AI component recognition
  componentGraph: ComponentGraph | null;
  isRecognizing: boolean;
  showComponentOverlay: boolean;

  // Visual diff (Feature 3)
  originalDrawingSnapshot: ParsedDrawing | null;
  showDiff: boolean;

  // Constraints (Feature 5)
  constraints: Constraint[];
  constraintViolations: ConstraintViolation[];

  // History
  scaleHistory: ScaleOperation[];
  undoStack: DrawingSnapshot[];
  redoStack: DrawingSnapshot[];

  // Actions
  loadDXFFile: (content: string, fileName: string) => void;
  selectComponent: (componentId: string | null) => void;
  hoverComponent: (componentId: string | null) => void;
  setScaleMode: (mode: ScaleMode) => void;
  toggleLayerVisibility: (layerName: string) => void;
  setAllLayerVisibility: (visible: boolean) => void;
  applyScale: (params: ScaleParams) => void;
  undo: () => void;
  redo: () => void;
  getSelectedComponent: () => CADComponent | null;
  reset: () => void;

  // Dimension actions
  selectDimension: (dimensionId: string | null) => void;
  applyDimensionChange: (params: ModifyDimensionParams) => void;
  applyAIDimensionChange: (params: {
    dimensionId: string;
    newValue?: number;
    scalePercent?: number;
    userInstruction?: string;
    pivotSide?: "auto" | "anchor0" | "anchor1";
  }) => Promise<void>;
  clearResizeError: () => void;

  // Cascade actions
  applyCascadeSuggestion: (index: number) => void;
  applyCascadeAll: () => void;
  dismissCascade: () => void;

  // PDF import
  loadPDFEntities: (pdfData: PDFExtractResult, fileName: string) => void;
  setPDFPage: (page: number) => void;

  // Tab actions
  openFileAsTab: (drawingId: string, fileName: string, dxfContent: string) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  getActiveTab: () => FileTab | null;

  // Composite analysis actions
  setCompositeAnalysis: (analysis: CompositeAnalysis | null) => void;
  setAnalyzing: (analyzing: boolean, error?: string | null) => void;
  storePageDimensions: (pageSource: string, dimensions: ParametricDimension[]) => void;

  // Component recognition actions
  recognizeComponents: () => Promise<void>;
  clearComponentGraph: () => void;
  toggleComponentOverlay: () => void;

  // Visual diff actions (Feature 3)
  toggleDiff: () => void;

  // Batch cascade actions (Feature 2)
  applyCascadeHighConfidence: () => void;

  // Constraint engine actions (Feature 5)
  addConstraint: (constraint: Constraint) => void;
  removeConstraint: (constraintId: string) => void;
  evaluateConstraints: () => void;

  // Intent-based editing (Feature 6)
  applyIntentChanges: (intent: string) => Promise<void>;

  /** Save the current drawing state to Supabase */
  saveCurrentDrawing: () => Promise<void>;

  /** Apply dimension change with cross-page propagation */
  applyDimensionChangeWithPropagation: (params: {
    dimensionId: string;
    newValue?: number;
    scalePercent?: number;
    userInstruction?: string;
    pivotSide?: "auto" | "anchor0" | "anchor1";
  }) => Promise<void>;
}

/** Shape of the JSON returned by /api/extract-pdf */
interface PDFExtractResult {
  entities: Array<{
    handle: string;
    type: string;
    layer: string;
    vertices?: Array<{ x: number; y: number }>;
    center?: { x: number; y: number };
    radius?: number;
    text?: string;
    insertionPoint?: { x: number; y: number };
    textHeight?: number;
    closed?: boolean;
    colorHex?: string;
    lineWidth?: number;
    page?: number; // 1-based page number
  }>;
  bounds: { min: { x: number; y: number }; max: { x: number; y: number } };
  pages: Array<{ width: number; height: number }>;
  pageCount?: number;
  metadata: { title: string; creator: string };
  entityCount: number;
  textCount: number;
}

let tabCounter = 0;

/** Build a ParsedDrawing from a set of PDF entities for a single page */
function buildPDFDrawing(
  entities: ParsedEntity[],
  fileName: string,
  pageInfo?: { width: number; height: number }
): ParsedDrawing {
  // Compute bounds from actual entity coordinates
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    if (e.vertices) {
      for (const v of e.vertices) {
        if (isFinite(v.x) && isFinite(v.y)) {
          if (v.x < minX) minX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.x > maxX) maxX = v.x;
          if (v.y > maxY) maxY = v.y;
        }
      }
    }
    if (e.center) {
      const r = e.radius || 0;
      if (e.center.x - r < minX) minX = e.center.x - r;
      if (e.center.y - r < minY) minY = e.center.y - r;
      if (e.center.x + r > maxX) maxX = e.center.x + r;
      if (e.center.y + r > maxY) maxY = e.center.y + r;
    }
    if (e.insertionPoint) {
      if (e.insertionPoint.x < minX) minX = e.insertionPoint.x;
      if (e.insertionPoint.y < minY) minY = e.insertionPoint.y;
      if (e.insertionPoint.x > maxX) maxX = e.insertionPoint.x;
      if (e.insertionPoint.y > maxY) maxY = e.insertionPoint.y;
    }
  }
  if (!isFinite(minX)) {
    // Fallback to page dimensions
    minX = 0; minY = 0;
    maxX = pageInfo?.width || 100;
    maxY = pageInfo?.height || 100;
  }

  const layerNames = new Set(entities.map((e) => e.layer));
  const layers = Array.from(layerNames).map((name) => ({
    name,
    color: name === "PDF-Text" ? 7 : 0,
    visible: true,
    frozen: false,
    entityCount: entities.filter((e) => e.layer === name).length,
  }));

  return {
    fileName,
    layers,
    components: [],
    entities,
    bounds: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
    units: "points",
  };
}

export const useCADStore = create<CADStore>((set, get) => ({
  drawing: null,
  isLoading: false,
  error: null,
  tabs: [],
  activeTabId: null,
  selectedComponentId: null,
  hoveredComponentId: null,
  dimensions: [],
  selectedDimensionId: null,
  scaleMode: "linked",
  layerVisibility: {},
  pdfPageCount: 0,
  pdfCurrentPage: 1,
  pdfAllEntities: [],
  pdfPages: [],
  pdfFileName: null,
  isResizing: false,
  resizeError: null,
  lastResizeReasoning: null,
  lastModification: null,
  compositeAnalysis: null,
  isAnalyzing: false,
  analysisError: null,
  allPageDimensions: new Map(),
  cascadeSuggestions: [],
  componentGraph: null,
  isRecognizing: false,
  showComponentOverlay: false,
  originalDrawingSnapshot: null,
  showDiff: false,
  constraints: [],
  constraintViolations: [],
  scaleHistory: [],
  undoStack: [],
  redoStack: [],

  loadDXFFile: (content: string, fileName: string) => {
    set({ isLoading: true, error: null });
    try {
      const drawing = parseDXF(content, fileName);
      // Run component detection
      drawing.components = detectComponents(drawing);

      // Auto-link parametric dimensions
      const dimensions = linkDimensions(drawing);

      // Initialize layer visibility
      const layerVisibility: Record<string, boolean> = {};
      for (const layer of drawing.layers) {
        layerVisibility[layer.name] = layer.visible;
      }

      set({
        drawing,
        dimensions,
        isLoading: false,
        layerVisibility,
        selectedComponentId: null,
        hoveredComponentId: null,
        selectedDimensionId: null,
        scaleHistory: [],
        undoStack: [],
        redoStack: [],
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to parse DXF file",
      });
    }
  },

  loadPDFEntities: (pdfData: PDFExtractResult, fileName: string) => {
    set({ isLoading: true, error: null });
    try {
      const pages = pdfData.pages || [];
      const pageCount = pdfData.pageCount || pages.length || 1;

      // Check if this is our pre-processed format (already Y-flipped)
      const isPreProcessed = (pdfData as unknown as Record<string, unknown>).format === "elfx-v1";

      let allEntities: PDFPageEntity[];

      if (isPreProcessed) {
        // Already processed — use entities directly (no Y-flip needed)
        // Spread all properties to preserve startAngle, endAngle, color, etc.
        allEntities = pdfData.entities.map((e) => {
          const { page, ...rest } = e;
          return { ...rest, _page: page || 1 } as PDFPageEntity;
        });
      } else {
        // Original PDF extract format — Y-flip all entities using their page's height
        allEntities = pdfData.entities.map((e) => {
          const pageNum = e.page || 1;
          const pageInfo = pages[pageNum - 1];
          const pageHeight = pageInfo?.height || pdfData.bounds.max.y;

          const entity: PDFPageEntity = {
            handle: e.handle,
            type: e.type,
            layer: e.layer,
            _page: pageNum,
          };

          if (e.vertices) {
            entity.vertices = e.vertices.map((v) => ({
              x: v.x,
              y: pageHeight - v.y,
            }));
          }
          if (e.center) {
            entity.center = { x: e.center.x, y: pageHeight - e.center.y };
            entity.radius = e.radius;
          }
          if (e.insertionPoint) {
            entity.insertionPoint = {
              x: e.insertionPoint.x,
              y: pageHeight - e.insertionPoint.y,
            };
          }
          if (e.text) entity.text = e.text;
          if (e.textHeight) entity.textHeight = e.textHeight;
          if (e.closed) entity.closed = e.closed;
          if (e.colorHex) entity.colorHex = e.colorHex;
          if (e.lineWidth) entity.lineWidth = e.lineWidth;

          return entity;
        });
      }

      // Build drawing for page 1
      const page1Entities = allEntities
        .filter((e) => e._page === 1)
        .map(({ _page, ...rest }) => rest as ParsedEntity);

      const drawing = buildPDFDrawing(page1Entities, fileName, pages[0]);

      // Auto-link dimensions
      const dimensions = linkDimensions(drawing);

      // Initialize layer visibility
      const layerVisibility: Record<string, boolean> = {};
      for (const layer of drawing.layers) {
        layerVisibility[layer.name] = true;
      }

      set({
        drawing,
        dimensions,
        isLoading: false,
        layerVisibility,
        pdfPageCount: pageCount,
        pdfCurrentPage: 1,
        pdfAllEntities: allEntities,
        pdfPages: pages,
        pdfFileName: fileName,
        selectedComponentId: null,
        hoveredComponentId: null,
        selectedDimensionId: null,
        scaleHistory: [],
        undoStack: [],
        redoStack: [],
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load PDF entities",
      });
    }
  },

  setPDFPage: (page: number) => {
    const { pdfAllEntities, pdfPages, pdfPageCount, pdfFileName, allPageDimensions } = get();
    if (page < 1 || page > pdfPageCount || !pdfFileName) return;

    const pageEntities = pdfAllEntities
      .filter((e) => e._page === page)
      .map(({ _page, ...rest }) => rest as ParsedEntity);

    const drawing = buildPDFDrawing(pageEntities, pdfFileName, pdfPages[page - 1]);

    // Use stored page dimensions if available (from composite analysis or prior edits),
    // otherwise re-link from scratch
    const pageSource = `pdf:${page}`;
    const storedDims = allPageDimensions.get(pageSource);
    const dimensions = storedDims || linkDimensions(drawing);

    const layerVisibility: Record<string, boolean> = {};
    for (const layer of drawing.layers) {
      layerVisibility[layer.name] = true;
    }

    set({
      drawing,
      dimensions,
      pdfCurrentPage: page,
      layerVisibility,
      selectedComponentId: null,
      hoveredComponentId: null,
      selectedDimensionId: null,
      scaleHistory: [],
      undoStack: [],
      redoStack: [],
    });
  },

  openFileAsTab: (drawingId: string, fileName: string, dxfContent: string) => {
    const { tabs } = get();
    const isPdf = fileName.toLowerCase().endsWith(".pdf");

    // Check if this source file already has an open working tab
    const existingTab = tabs.find(
      (t) => t.sourceDrawingId === drawingId && t.type === "working"
    );
    if (existingTab) {
      // Switch to existing working tab
      get().switchTab(existingTab.id);
      return;
    }

    // Create a working copy tab
    tabCounter++;
    const baseName = fileName.replace(/\.(dxf|dwg|pdf)$/i, "");
    const tabId = `tab-${tabCounter}-${Date.now()}`;
    const newTab: FileTab = {
      id: tabId,
      sourceDrawingId: drawingId,
      label: baseName,
      fileName,
      type: "working",
      dxfContent,
      isPdf,
      isDirty: false,
    };

    set({ tabs: [...tabs, newTab] });

    // Switch to the new tab (loads it into the viewer)
    get().switchTab(tabId);
  },

  switchTab: (tabId: string) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    set({ activeTabId: tabId });

    if (tab.isPdf) {
      // Try to load PDF as CAD entities if we have extracted JSON
      try {
        const pdfData = JSON.parse(tab.dxfContent);
        if (pdfData.entities && pdfData.bounds) {
          // This is extracted PDF data — load as CAD
          get().loadPDFEntities(pdfData, tab.fileName);
          return;
        }
      } catch {
        // Not JSON — it's a legacy data URL, show as iframe
      }
      set({
        drawing: null,
        selectedComponentId: null,
        hoveredComponentId: null,
        dimensions: [],
        selectedDimensionId: null,
        scaleHistory: [],
        undoStack: [],
        layerVisibility: {},
      });
    } else {
      // Load DXF into the viewer
      get().loadDXFFile(tab.dxfContent, tab.fileName);
    }
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId } = get();
    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const newTabs = tabs.filter((t) => t.id !== tabId);
    set({ tabs: newTabs });

    // If we closed the active tab, switch to the nearest remaining tab
    if (activeTabId === tabId) {
      if (newTabs.length === 0) {
        set({
          activeTabId: null,
          drawing: null,
          selectedComponentId: null,
          hoveredComponentId: null,
          scaleHistory: [],
          undoStack: [],
          redoStack: [],
          layerVisibility: {},
        });
      } else {
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        get().switchTab(newTabs[newIndex].id);
      }
    }
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return null;
    return tabs.find((t) => t.id === activeTabId) || null;
  },

  selectComponent: (componentId: string | null) => {
    set({ selectedComponentId: componentId });
  },

  hoverComponent: (componentId: string | null) => {
    set({ hoveredComponentId: componentId });
  },

  setScaleMode: (mode: ScaleMode) => {
    set({ scaleMode: mode });
  },

  toggleLayerVisibility: (layerName: string) => {
    const { layerVisibility } = get();
    set({
      layerVisibility: {
        ...layerVisibility,
        [layerName]: !layerVisibility[layerName],
      },
    });
  },

  setAllLayerVisibility: (visible: boolean) => {
    const { drawing } = get();
    if (!drawing) return;
    const layerVisibility: Record<string, boolean> = {};
    for (const layer of drawing.layers) {
      layerVisibility[layer.name] = visible;
    }
    set({ layerVisibility });
  },

  applyScale: (params: ScaleParams) => {
    const { drawing, dimensions, scaleMode, scaleHistory, undoStack, tabs, activeTabId } = get();
    if (!drawing) return;

    try {
      const result = scaleComponent(drawing, params, scaleMode);

      // Mark the active tab as dirty
      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId ? { ...t, isDirty: true } : t
      );

      set({
        drawing: result.drawing,
        scaleHistory: [...scaleHistory, result.operation],
        undoStack: [...undoStack, { drawing, dimensions }],
        redoStack: [],
        tabs: updatedTabs,
      });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to apply scale",
      });
    }
  },

  undo: () => {
    const { drawing, dimensions, undoStack, redoStack, scaleHistory } = get();
    if (undoStack.length === 0 || !drawing) return;

    const prev = undoStack[undoStack.length - 1];
    set({
      drawing: prev.drawing,
      dimensions: prev.dimensions,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { drawing, dimensions }],
      scaleHistory: scaleHistory.slice(0, -1),
    });
  },

  redo: () => {
    const { drawing, dimensions, undoStack, redoStack } = get();
    if (redoStack.length === 0 || !drawing) return;

    const next = redoStack[redoStack.length - 1];
    set({
      drawing: next.drawing,
      dimensions: next.dimensions,
      undoStack: [...undoStack, { drawing, dimensions }],
      redoStack: redoStack.slice(0, -1),
    });
  },

  getSelectedComponent: () => {
    const { drawing, selectedComponentId } = get();
    if (!drawing || !selectedComponentId) return null;
    return (
      drawing.components.find((c) => c.id === selectedComponentId) || null
    );
  },

  selectDimension: (dimensionId: string | null) => {
    set({ selectedDimensionId: dimensionId, cascadeSuggestions: [] });
  },

  applyDimensionChange: (params: ModifyDimensionParams) => {
    const { drawing, dimensions, undoStack, tabs, activeTabId, originalDrawingSnapshot, componentGraph } = get();
    if (!drawing) return;

    // Capture snapshot before first edit (for visual diff)
    if (!originalDrawingSnapshot) {
      set({ originalDrawingSnapshot: JSON.parse(JSON.stringify(drawing)) });
    }

    try {
      // Pass component graph for smarter entity selection
      const enrichedParams = componentGraph
        ? { ...params, componentGraph }
        : params;
      const result = modifyDimension(drawing, dimensions, enrichedParams);

      // Sanity check: modifyDimension must return a valid drawing
      if (!result.drawing || !result.drawing.entities) {
        console.error("[applyDimensionChange] modifyDimension returned invalid drawing", result);
        set({ error: "Dimension change produced invalid result" });
        return;
      }

      console.log(
        `[applyDimensionChange] scaleFactor=${result.modification.scaleFactor.toFixed(4)}, ` +
        `affected=${result.modification.affectedEntities.length} entities, ` +
        `total=${result.drawing.entities.length} entities`
      );

      // Mark the active tab as dirty
      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId ? { ...t, isDirty: true } : t
      );

      // Sync modified entities back to pdfAllEntities so changes survive page switches
      const { pdfCurrentPage, pdfAllEntities } = get();
      let updatedPdfEntities = pdfAllEntities;
      if (pdfAllEntities.length > 0 && pdfCurrentPage > 0) {
        const newEntityMap = new Map(
          result.drawing.entities.map(e => [e.handle, e])
        );
        updatedPdfEntities = pdfAllEntities.map(e => {
          if (e._page !== pdfCurrentPage) return e;
          const newEntity = newEntityMap.get(e.handle);
          if (!newEntity) return e;
          return { ...newEntity, _page: pdfCurrentPage } as PDFPageEntity;
        });
      }

      // Compute cascade suggestions before setting state
      const modifiedDim = result.dimensions.find(d => d.id === params.dimensionId);
      let suggestions: CascadeSuggestion[] = [];
      if (modifiedDim && result.modification.pivot && result.modification.axis && result.modification.displacement) {
        try {
          // Use connectivity-aware cascade if component graph exists
          const { componentGraph } = get();
          if (componentGraph && componentGraph.components.length > 0) {
            suggestions = analyzeConnectedCascade(
              componentGraph,
              params.dimensionId,
              result.modification.displacement,
              result.dimensions
            );
            console.log(`[cascade] Connected cascade: ${suggestions.length} suggestions`);
          }
          // Fall back to spatial cascade if no graph or no suggestions
          if (suggestions.length === 0) {
            suggestions = analyzeCascade(result.modification, modifiedDim, result.dimensions);
            console.log(`[cascade] Spatial cascade: ${suggestions.length} suggestions`);
          }
        } catch (cascadeErr) {
          console.warn("[cascade] Analysis failed:", cascadeErr);
        }
      }

      set({
        drawing: result.drawing,
        dimensions: result.dimensions,
        undoStack: [...undoStack, { drawing, dimensions }],
        redoStack: [],
        tabs: updatedTabs,
        pdfAllEntities: updatedPdfEntities,
        lastModification: result.modification,
        cascadeSuggestions: suggestions,
      });

      // Evaluate constraints after change
      get().evaluateConstraints();

      // Clear lastModification after flash duration
      setTimeout(() => {
        if (get().lastModification === result.modification) {
          set({ lastModification: null });
        }
      }, 2000);
    } catch (err) {
      console.error("[applyDimensionChange] error:", err);
      set({
        error: err instanceof Error ? err.message : "Failed to modify dimension",
      });
    }
  },

  applyAIDimensionChange: async (params) => {
    const { drawing, dimensions, undoStack, tabs, activeTabId } = get();
    if (!drawing) return;

    const dim = dimensions.find((d) => d.id === params.dimensionId);
    if (!dim) {
      set({ resizeError: "Dimension not found" });
      return;
    }

    // Calculate the new value
    let newValue: number;
    if (params.newValue !== undefined) {
      newValue = params.newValue;
    } else if (params.scalePercent !== undefined) {
      newValue = dim.value * (params.scalePercent / 100);
    } else {
      set({ resizeError: "Must provide newValue or scalePercent" });
      return;
    }

    set({ isResizing: true, resizeError: null, lastResizeReasoning: null, error: null });

    // Find the component for this dimension
    const component = findComponentForDimension(dim, drawing.components);

    // If no component detected (typical for PDF-extracted drawings),
    // skip AI and use mechanical resize with spatial entity gathering
    if (!component) {
      get().applyDimensionChange({
        dimensionId: params.dimensionId,
        newValue: params.newValue,
        scalePercent: params.scalePercent,
        proportional: false,
        pivotSide: params.pivotSide,
      });
      set({
        isResizing: false,
        lastResizeReasoning: "Applied proportional resize across nearby geometry",
      });
      return;
    }

    // Collect entities to send (capped at 150)
    const entityHandles = new Set<string>();
    for (const h of dim.geometryHandles) entityHandles.add(h);
    for (const h of dim.annotationHandles) entityHandles.add(h);
    entityHandles.add(dim.textHandle);
    if (component) {
      for (const h of component.entityHandles) entityHandles.add(h);
    }

    const entitiesToSend = drawing.entities
      .filter((e) => entityHandles.has(e.handle))
      .slice(0, 150)
      .map((e) => ({
        handle: e.handle,
        type: e.type,
        layer: e.layer,
        vertices: e.vertices,
        center: e.center,
        radius: e.radius,
        insertionPoint: e.insertionPoint,
        text: e.text,
      }));

    try {
      const response = await fetch("/api/ai-resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dimension: {
            id: dim.id,
            displayText: dim.displayText,
            value: dim.value,
            newValue,
            direction: dim.direction,
            anchorPoints: dim.anchorPoints,
            expandDirection: dim.expandDirection,
            geometryHandles: dim.geometryHandles,
            annotationHandles: dim.annotationHandles,
            textHandle: dim.textHandle,
          },
          component: component
            ? {
                name: component.name,
                type: component.type,
                boundingBox: component.boundingBox,
                entityHandles: component.entityHandles,
              }
            : null,
          entities: entitiesToSend,
          userInstruction: params.userInstruction,
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `AI resize failed: ${response.status}`);
      }

      const result: AIResizeResponse = await response.json();

      if (!result.transforms || result.transforms.length === 0) {
        throw new Error("AI returned no transforms");
      }

      // Validate transforms
      const validationError = validateTransforms(drawing, result.transforms);
      if (validationError) {
        console.warn("[AI Resize] Validation failed, falling back:", validationError);
        throw new Error(validationError);
      }

      // Apply transforms
      const { drawing: newDrawing, affectedHandles } = applyTransforms(
        drawing,
        result.transforms
      );

      console.log(
        `[AI Resize] Applied ${result.transforms.length} transforms, ` +
          `affected ${affectedHandles.length} entities. Reasoning: ${result.reasoning}`
      );

      // Update the dimension's stored value and text
      const newDimensions = dimensions.map((d) => {
        if (d.id !== dim.id) return d;
        return {
          ...d,
          value: newValue,
          displayText: formatImperialDimension(newValue),
        };
      });

      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId ? { ...t, isDirty: true } : t
      );

      set({
        drawing: newDrawing,
        dimensions: newDimensions,
        undoStack: [...undoStack, { drawing, dimensions }],
        redoStack: [],
        tabs: updatedTabs,
        isResizing: false,
        lastResizeReasoning: result.reasoning,
      });
    } catch (err) {
      console.error("[AI Resize] Error, falling back to mechanical:", err);
      set({ isResizing: false });

      // Fall back to mechanical resize
      get().applyDimensionChange({
        dimensionId: params.dimensionId,
        newValue: params.newValue,
        scalePercent: params.scalePercent,
        proportional: false,
        pivotSide: params.pivotSide,
      });

      set({
        resizeError: `AI resize unavailable, used mechanical fallback. ${
          err instanceof Error ? err.message : ""
        }`.trim(),
      });
    }
  },

  clearResizeError: () => {
    set({ resizeError: null, lastResizeReasoning: null });
  },

  applyCascadeSuggestion: (index: number) => {
    const { drawing, dimensions, cascadeSuggestions, undoStack, tabs, activeTabId } = get();
    if (!drawing || index < 0 || index >= cascadeSuggestions.length) return;

    const suggestion = cascadeSuggestions[index];
    if (suggestion.action !== "shift" || !suggestion.displacement) {
      // For now only support shift — resize suggestions can be implemented later
      console.warn("[cascade] Only shift actions are supported currently");
      return;
    }

    try {
      const result = shiftDimension(drawing, dimensions, suggestion.dimensionId, suggestion.displacement);

      // Mark tab dirty
      const updatedTabs = tabs.map(t =>
        t.id === activeTabId ? { ...t, isDirty: true } : t
      );

      // Sync to pdfAllEntities
      const { pdfCurrentPage, pdfAllEntities } = get();
      let updatedPdfEntities = pdfAllEntities;
      if (pdfAllEntities.length > 0 && pdfCurrentPage > 0) {
        const newEntityMap = new Map(result.drawing.entities.map(e => [e.handle, e]));
        updatedPdfEntities = pdfAllEntities.map(e => {
          if (e._page !== pdfCurrentPage) return e;
          const newEntity = newEntityMap.get(e.handle);
          if (!newEntity) return e;
          return { ...newEntity, _page: pdfCurrentPage } as PDFPageEntity;
        });
      }

      // Remove applied suggestion from list
      const remaining = cascadeSuggestions.filter((_, i) => i !== index);

      set({
        drawing: result.drawing,
        dimensions: result.dimensions,
        undoStack: [...undoStack, { drawing, dimensions }],
        redoStack: [],
        tabs: updatedTabs,
        pdfAllEntities: updatedPdfEntities,
        lastModification: result.modification,
        cascadeSuggestions: remaining,
      });

      // Clear flash after delay
      setTimeout(() => {
        if (get().lastModification === result.modification) {
          set({ lastModification: null });
        }
      }, 2000);
    } catch (err) {
      console.error("[cascade] Failed to apply suggestion:", err);
    }
  },

  applyCascadeAll: () => {
    const { cascadeSuggestions } = get();
    // Apply from last to first to avoid index shifting issues
    for (let i = 0; i < cascadeSuggestions.length; i++) {
      // Always apply index 0 since each application removes the applied one
      get().applyCascadeSuggestion(0);
    }
  },

  dismissCascade: () => {
    set({ cascadeSuggestions: [] });
  },

  setCompositeAnalysis: (analysis: CompositeAnalysis | null) => {
    set({ compositeAnalysis: analysis, analysisError: null });
  },

  setAnalyzing: (analyzing: boolean, error?: string | null) => {
    set({ isAnalyzing: analyzing, analysisError: error ?? null });
  },

  storePageDimensions: (pageSource: string, dimensions: ParametricDimension[]) => {
    const { allPageDimensions } = get();
    const updated = new Map(allPageDimensions);
    updated.set(pageSource, dimensions);
    set({ allPageDimensions: updated });
  },

  recognizeComponents: async () => {
    const { drawing, dimensions } = get();
    if (!drawing) return;

    set({ isRecognizing: true });

    try {
      // Build geometry summary for AI
      const summary = summarizeGeometry(drawing, dimensions);
      const drawingBounds = {
        minX: drawing.bounds.min.x,
        minY: drawing.bounds.min.y,
        maxX: drawing.bounds.max.x,
        maxY: drawing.bounds.max.y,
      };

      // Call AI recognition API
      const response = await fetch("/api/ai-recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, drawingBounds }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `AI recognition failed: ${response.status}`);
      }

      const result = await response.json();

      // Assign dimensionIds to components based on spatial containment
      const components = result.components.map((comp: { id: string; type: string; label: string; boundingBox: { minX: number; minY: number; maxX: number; maxY: number }; confidence: number; dimensionIds: string[] }) => {
        const dimIds: string[] = [];
        for (const dim of dimensions) {
          const mid = {
            x: (dim.anchorPoints[0].x + dim.anchorPoints[1].x) / 2,
            y: (dim.anchorPoints[0].y + dim.anchorPoints[1].y) / 2,
          };
          if (
            mid.x >= comp.boundingBox.minX &&
            mid.x <= comp.boundingBox.maxX &&
            mid.y >= comp.boundingBox.minY &&
            mid.y <= comp.boundingBox.maxY
          ) {
            dimIds.push(dim.id);
          }
        }
        return { ...comp, dimensionIds: dimIds };
      });

      // Build connectivity edges
      const edges = buildConnectivityGraph(components, result.flowDirection);

      set({
        componentGraph: {
          components,
          edges,
          flowDirection: result.flowDirection,
        },
        isRecognizing: false,
      });

      console.log(
        `[recognizeComponents] Found ${components.length} components, ` +
        `${edges.length} edges, flow: ${result.flowDirection}`
      );
    } catch (err) {
      console.error("[recognizeComponents] Error:", err);
      set({ isRecognizing: false });
    }
  },

  clearComponentGraph: () => {
    set({ componentGraph: null, showComponentOverlay: false });
  },

  toggleComponentOverlay: () => {
    set((state) => ({ showComponentOverlay: !state.showComponentOverlay }));
  },

  toggleDiff: () => {
    set((state) => ({ showDiff: !state.showDiff }));
  },

  applyCascadeHighConfidence: () => {
    const { cascadeSuggestions } = get();
    const highIndices = cascadeSuggestions
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.confidence === "high")
      .map(({ i }) => i)
      .reverse(); // Apply from end to avoid index shifting
    for (const idx of highIndices) {
      // Re-fetch since each apply mutates the list
      const current = get().cascadeSuggestions;
      const realIdx = current.findIndex(s =>
        cascadeSuggestions[idx] && s.dimensionId === cascadeSuggestions[idx].dimensionId
      );
      if (realIdx >= 0) get().applyCascadeSuggestion(realIdx);
    }
  },

  addConstraint: (constraint: Constraint) => {
    set((state) => ({
      constraints: [...state.constraints, constraint],
    }));
    get().evaluateConstraints();
  },

  removeConstraint: (constraintId: string) => {
    set((state) => ({
      constraints: state.constraints.filter(c => c.id !== constraintId),
      constraintViolations: state.constraintViolations.filter(v => v.constraintId !== constraintId),
    }));
  },

  evaluateConstraints: () => {
    const { constraints, dimensions } = get();
    const violations: ConstraintViolation[] = [];

    for (const constraint of constraints) {
      const dimValues = constraint.dimensionIds
        .map(id => dimensions.find(d => d.id === id))
        .filter(Boolean)
        .map(d => d!.value);

      if (dimValues.length === 0) continue;

      switch (constraint.type) {
        case "sum": {
          const sum = dimValues.reduce((a, b) => a + b, 0);
          if (sum > constraint.threshold) {
            violations.push({
              constraintId: constraint.id,
              label: constraint.label,
              message: `Sum ${formatImperialDimension(sum)} exceeds ${formatImperialDimension(constraint.threshold)}`,
              currentValue: sum,
              threshold: constraint.threshold,
              severity: constraint.severity,
            });
          }
          break;
        }
        case "max": {
          const maxVal = Math.max(...dimValues);
          if (maxVal > constraint.threshold) {
            violations.push({
              constraintId: constraint.id,
              label: constraint.label,
              message: `${formatImperialDimension(maxVal)} exceeds max ${formatImperialDimension(constraint.threshold)}`,
              currentValue: maxVal,
              threshold: constraint.threshold,
              severity: constraint.severity,
            });
          }
          break;
        }
        case "min": {
          const minVal = Math.min(...dimValues);
          if (minVal < constraint.threshold) {
            violations.push({
              constraintId: constraint.id,
              label: constraint.label,
              message: `${formatImperialDimension(minVal)} below min ${formatImperialDimension(constraint.threshold)}`,
              currentValue: minVal,
              threshold: constraint.threshold,
              severity: constraint.severity,
            });
          }
          break;
        }
        case "clearance": {
          // For clearance, threshold is the minimum gap
          if (dimValues.length >= 1 && dimValues[0] < constraint.threshold) {
            violations.push({
              constraintId: constraint.id,
              label: constraint.label,
              message: `Clearance ${formatImperialDimension(dimValues[0])} below ${formatImperialDimension(constraint.threshold)}`,
              currentValue: dimValues[0],
              threshold: constraint.threshold,
              severity: constraint.severity,
            });
          }
          break;
        }
      }
    }

    set({ constraintViolations: violations });
  },

  applyIntentChanges: async (intent: string) => {
    const { drawing, dimensions, componentGraph } = get();
    if (!drawing || dimensions.length === 0) return;

    set({ isResizing: true, resizeError: null });

    try {
      const response = await fetch("/api/ai-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          dimensions: dimensions.map(d => ({
            id: d.id,
            displayText: d.displayText,
            value: d.value,
            direction: d.direction,
          })),
          componentGraph: componentGraph ? {
            components: componentGraph.components.map(c => ({
              id: c.id,
              type: c.type,
              label: c.label,
              dimensionIds: c.dimensionIds,
            })),
            flowDirection: componentGraph.flowDirection,
          } : null,
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Intent failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.changes || result.changes.length === 0) {
        set({ isResizing: false, lastResizeReasoning: result.overallReasoning || "No changes needed" });
        return;
      }

      // Apply each change sequentially
      for (const change of result.changes) {
        const dim = get().dimensions.find(d => d.id === change.dimensionId);
        if (!dim) continue;
        get().applyDimensionChange({
          dimensionId: change.dimensionId,
          newValue: change.newValue,
          proportional: false,
        });
      }

      set({
        isResizing: false,
        lastResizeReasoning: result.overallReasoning,
      });
    } catch (err) {
      console.error("[intent] Error:", err);
      set({
        isResizing: false,
        resizeError: err instanceof Error ? err.message : "Intent processing failed",
      });
    }
  },

  saveCurrentDrawing: async () => {
    const { tabs, activeTabId, drawing, pdfAllEntities, pdfPages, pdfPageCount, pdfFileName } = get();
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab || !drawing) throw new Error("No active drawing to save");

    let content: string;

    if (activeTab.isPdf && pdfAllEntities.length > 0) {
      // Serialize PDF entities in our internal format (already Y-flipped)
      const saveData = {
        format: "elfx-v1",
        entities: pdfAllEntities.map(({ _page, ...rest }) => ({
          ...rest,
          page: _page,
        })),
        pages: pdfPages,
        pageCount: pdfPageCount,
        bounds: drawing.bounds,
        metadata: { title: pdfFileName || "Drawing", creator: "EnergyLink FLEX" },
        entityCount: pdfAllEntities.length,
        textCount: pdfAllEntities.filter(e => e.type === "TEXT" || e.type === "MTEXT").length,
      };
      content = JSON.stringify(saveData);
    } else {
      // For DXF, save the current DXF content (TODO: serialize modified entities)
      content = activeTab.dxfContent;
    }

    // Save to Supabase via project store
    const { useProjectStore } = await import("@/lib/projects/store");
    await useProjectStore.getState().updateDrawingContent(
      activeTab.sourceDrawingId,
      content
    );

    // Mark tab as clean and update cached content
    const updatedTabs = tabs.map(t =>
      t.id === activeTabId ? { ...t, isDirty: false, dxfContent: content } : t
    );
    set({ tabs: updatedTabs });
  },

  applyDimensionChangeWithPropagation: async (params) => {
    // First apply the change on the current page using the AI resize flow
    await get().applyAIDimensionChange(params);

    // Then propagate to other pages if composite analysis is available
    const {
      compositeAnalysis,
      dimensions,
      pdfCurrentPage,
      pdfAllEntities,
      pdfPages,
      pdfFileName,
      allPageDimensions,
    } = get();

    if (!compositeAnalysis || pdfAllEntities.length === 0 || !pdfFileName) return;

    const dim = dimensions.find((d) => d.id === params.dimensionId);
    if (!dim) return;

    // Determine the new value
    let newValue: number;
    if (params.newValue !== undefined) {
      newValue = params.newValue;
    } else if (params.scalePercent !== undefined) {
      newValue = dim.value; // dim.value is already updated by applyAIDimensionChange
    } else {
      return;
    }

    const currentPageSource = `pdf:${pdfCurrentPage}`;

    // Store current page dimensions before propagating
    const updatedDims = new Map(allPageDimensions);
    updatedDims.set(currentPageSource, get().dimensions);

    const result = propagateDimensionChange(
      params.dimensionId,
      newValue,
      currentPageSource,
      compositeAnalysis,
      pdfAllEntities,
      updatedDims,
      pdfPages,
      pdfFileName,
    );

    if (result.propagatedPages.length > 0) {
      console.log(`[cross-page] ${result.summary}`);
      set({
        pdfAllEntities: result.updatedEntities,
        allPageDimensions: result.updatedDimensions,
      });
    }
  },

  reset: () => {
    set({
      drawing: null,
      isLoading: false,
      error: null,
      tabs: [],
      activeTabId: null,
      selectedComponentId: null,
      hoveredComponentId: null,
      dimensions: [],
      selectedDimensionId: null,
      isResizing: false,
      resizeError: null,
      lastResizeReasoning: null,
      lastModification: null,
      cascadeSuggestions: [],
      componentGraph: null,
      isRecognizing: false,
      showComponentOverlay: false,
      originalDrawingSnapshot: null,
      showDiff: false,
      constraints: [],
      constraintViolations: [],
      compositeAnalysis: null,
      isAnalyzing: false,
      analysisError: null,
      allPageDimensions: new Map(),
      pdfPageCount: 0,
      pdfCurrentPage: 1,
      pdfAllEntities: [],
      pdfPages: [],
      pdfFileName: null,
      scaleHistory: [],
      undoStack: [],
      redoStack: [],
      layerVisibility: {},
    });
  },
}));
