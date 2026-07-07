"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import {
  parseDimInches,
  formatDimInches,
  dimKeyToDirection,
  applyMultiStretch,
  resolveContainerResiduals,
  undoStretches,
  saveOriginalViewBox,
  computeStretchDelta,
  findModelSpace,
  validateDimValue,
} from "@/lib/dwg/svg-stretch";
import type { StretchParams } from "@/lib/dwg/svg-stretch";
import { computeViewRegions, viewOf } from "@/lib/dwg/view-model";
import { isAnnotationBlockName, stripAnnotationUses } from "@/lib/dwg/annotations";
import { getDimBlockBounds, dimBlockBox2D, computeComponentBand } from "@/lib/dwg/dim-geometry";
import { detectDetachedAssemblies, CONF_MIN } from "@/lib/dwg/detached";
import type { ComponentDef } from "@/stores/editor-store";
import { MarkupOverlay } from "./markup-overlay";

/* ─── Constants ─── */

const MINIMAP_W = 180;
const DRAG_THRESHOLD = 5; // px — movements smaller than this count as click

/* ─── Dimension text matching ─── */

// Matches: 15'-0 1/8", 9'-8 3/4", 7'-0", ~16'-0", 05'-11 7/8"
const DIM_FEET_INCHES =
  /^[\u00d8~]?(\d+)['\u2018\u2032]\s*-?\s*(\d+)(?:\s+(\d+\/\d+))?["\u201d\u2033]?$/;
// Matches inches-only: 9", 8 3/4"
const DIM_INCHES_ONLY = /^(\d+)(?:\s+(\d+\/\d+))?["\u201d\u2033]$/;

function isDimensionText(text: string): boolean {
  const t = text.trim();
  return DIM_FEET_INCHES.test(t) || DIM_INCHES_ONLY.test(t);
}

/** Parse dimension text into { feet, inches, fraction } */
function parseDimParts(text: string): {
  feet: number;
  inches: number;
  fraction: string;
} {
  const t = text.trim();
  const feetMatch = t.match(DIM_FEET_INCHES);
  if (feetMatch) {
    return {
      feet: parseInt(feetMatch[1], 10),
      inches: parseInt(feetMatch[2], 10),
      fraction: feetMatch[3] || "",
    };
  }
  const inchMatch = t.match(DIM_INCHES_ONLY);
  if (inchMatch) {
    return {
      feet: 0,
      inches: parseInt(inchMatch[1], 10),
      fraction: inchMatch[2] || "",
    };
  }
  return { feet: 0, inches: 0, fraction: "" };
}

/** Build formatted dimension string from parts */
function formatDimText(
  feet: number,
  inches: number,
  fraction: string
): string {
  const frac = fraction.trim();
  if (frac) {
    return `${feet}'-${inches} ${frac}"`;
  }
  return `${feet}'-${inches}"`;
}

/** Common fraction options for the fraction dropdown */
const FRACTION_OPTIONS = [
  "",
  "1/16",
  "1/8",
  "3/16",
  "1/4",
  "5/16",
  "3/8",
  "7/16",
  "1/2",
  "9/16",
  "5/8",
  "11/16",
  "3/4",
  "13/16",
  "7/8",
  "15/16",
];

/** Determine if a dimension block measures Height or Width by analyzing its lines */
function getDimBlockDirection(
  blockId: string,
  svgEl: SVGSVGElement
): "Height" | "Width" {
  const defBlock = svgEl.querySelector(`[id="${CSS.escape(blockId)}"]`);
  if (!defBlock) return "Height";
  const lines = defBlock.querySelectorAll("line");
  if (lines.length === 0) return "Height";
  const dimLine = lines[lines.length - 1];
  const dx = Math.abs(
    parseFloat(dimLine.getAttribute("x2") || "0") -
      parseFloat(dimLine.getAttribute("x1") || "0")
  );
  const dy = Math.abs(
    parseFloat(dimLine.getAttribute("y2") || "0") -
      parseFloat(dimLine.getAttribute("y1") || "0")
  );
  return dy > dx ? "Height" : "Width";
}

/* ─── Inline editor state ─── */

interface InlineEdit {
  x: number;
  y: number;
  feet: number;
  inches: number;
  fraction: string;
  originalText: string;
  textEl: SVGTextElement;
  useGroupEl: SVGGElement | null;
  blockId: string;
}

/* ─── SVG Color Processing ─── */

/**
 * Process LibreDWG SVG text for light-background display.
 *
 * SVG STRUCTURE (from live DOM analysis of 75K-line Titan drawing):
 * - 75,746 elements with stroke="rgb(255,255,255)" (white — CAD dark-bg convention)
 * - 75,638 elements with fill="none" (correct, stroke-only shapes)
 * - 105 elements with fill="rgb(255,255,255)" (text elements — need black fill)
 * - 27,675 shapes with NO fill attribute (browser defaults to black → blobs!)
 * - 67 <g> elements in <defs> with NO fill attribute (<use> shadow DOM won't inherit)
 * - strokeWidth="0.1%" on elements (0.1% of viewBox diagonal ≈ 2px → thick overlapping = blobs)
 * - No explicit stroke-width on most elements (defaults to 1px)
 *
 * STRATEGY:
 * 1. White strokes → black (visible on white bg)
 * 2. White fills → black (text readable on white bg)
 * 3. CSS rule: elements without fill attr get fill:none (prevents black blob default)
 * 4. CSS rule: normalize stroke-width to thin fixed value (prevents thick stroke blobs)
 * 5. CSS rule: non-scaling-stroke for consistent line weight at any zoom
 * 6. Keep blue dimension lines, cyan, lime strokes as-is
 */
/** Layers that create dense hatching / visual noise for sales view */
const HIDDEN_LAYERS = new Set([
  "Hatch (ANSI)",
  "Hidden (ANSI)",
]);

function processLibreDwgSvg(svgText: string): string {
  return stripAnnotationUses(svgText)
    // Strip annotation-clutter <use>s (CriticalFeature blobs, borders, title/datum
    // symbols) at the source above, so no later stretch/undo/re-render can revive them
    // — the DOM-level display:none hide in postProcessSvgDom didn't stick at runtime.
    // White strokes → black (drawing lines on white background)
    .replace(/stroke="rgb\(255,255,255\)"/g, 'stroke="rgb(0,0,0)"')
    // White fills → black (text needs this to be visible)
    .replace(/fill="rgb\(255,255,255\)"/g, 'fill="rgb(0,0,0)"')
    // NUKE black fills on <g> elements — prevents fill inheritance into
    // <use> shadow DOM where CSS can't reliably reach
    .replace(/<g(\s[^>]*?)fill="rgb\(0,0,0\)"/g, '<g$1fill="none"')
    // Remove percentage-based stroke-widths that compute to huge values
    .replace(/stroke-width="[0-9.]+%"/g, 'stroke-width="0.5"')
    // Add vector-effect + fill="none" as presentation attributes on ALL shapes.
    // Belt-and-suspenders: CSS alone doesn't reliably penetrate <use> shadow DOM.
    .replace(/<(line|circle|ellipse|path|rect|polygon|polyline)\s/g,
      '<$1 fill="none" vector-effect="non-scaling-stroke" ')
    // Inject CSS fixes after opening <svg> tag
    .replace(
      /(<svg[^>]*>)/,
      `$1<style>
        svg { background: white; }
        /* Triple-layer fill fix: presentation attr + CSS + inheritance */
        line, circle, ellipse, path, polygon, polyline, rect {
          fill: none !important;
          vector-effect: non-scaling-stroke !important;
        }
        text { fill: rgb(0,0,0) !important; }
        defs g { fill: none; }
        use { fill: none; }
      </style>`
    );
}

/** Post-process the SVG DOM after injection to hide annotation clutter
 *  and filter layers that create visual noise in the sales view. */
function postProcessSvgDom(svgRoot: SVGSVGElement) {
  // 1. Hide annotation <use> blocks (datum markers, nozzle markers, etc.)
  //    These create "black blob" artifacts because their tiny shapes
  //    (< 1 SVG unit) get 0.5px strokes that fill the shape area.
  svgRoot.querySelectorAll("use").forEach((use) => {
    const href = (use.getAttribute("href") || "").replace("#", "");
    if (isAnnotationBlockName(href)) {
      const parent = use.parentElement;
      if (parent) parent.style.display = "none";
    }
  });

  // 2. Hide hatch/hidden layers that create dense black areas
  //    Walk <g> elements that represent layer groups
  svgRoot.querySelectorAll("g").forEach((g) => {
    // LibreDWG groups entities by layer — check parent chain for layer indicators
    const id = g.id || "";
    // Some LibreDWG outputs tag groups with the layer name
    // Check for explicit layer attribute
    const layerAttr = g.getAttribute("layer");
    if (layerAttr && HIDDEN_LAYERS.has(layerAttr)) {
      g.style.display = "none";
    }
  });

  // 3. Force fill="none" on any remaining shapes inside <defs>
  //    that might cascade through <use> shadow DOM
  svgRoot.querySelectorAll("defs g").forEach((g) => {
    g.setAttribute("fill", "none");
  });
}

/** A stretch was refused/rolled back: log the internal reason, surface a
 *  generic (non-technical) warning to the user. Never leaks `reason` to the UI. */
function notifyStretchFailed(reason: string) {
  console.error("[ELF stretch]", reason);
  useEditorStore.getState().setStretchWarning(
    "Couldn't safely apply this change; the drawing was left unchanged."
  );
}

/* ─── Structured Dimension Editor ─── */

function DimensionEditor({
  edit,
  onSubmit,
  onCancel,
}: {
  edit: InlineEdit;
  onSubmit: (newValue: string) => void;
  onCancel: () => void;
}) {
  const [feet, setFeet] = useState(edit.feet);
  const [inches, setInches] = useState(edit.inches);
  const [fraction, setFraction] = useState(edit.fraction);
  const feetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    feetRef.current?.select();
  }, []);

  const handleSubmit = () => {
    onSubmit(formatDimText(feet, inches, fraction));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="absolute z-50"
      style={{ left: edit.x, top: edit.y }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-xl border border-gray-200 bg-white shadow-2xl px-3 py-2.5"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}
        data-dim-editor
      >
        <div className="text-[9px] font-semibold text-blue-500/70 uppercase tracking-wider mb-1.5">
          Edit Dimension
        </div>
        <div className="flex items-center gap-1.5">
          {/* Feet */}
          <input
            ref={feetRef}
            type="number"
            min={0}
            max={999}
            value={feet}
            onChange={(e) =>
              setFeet(Math.max(0, parseInt(e.target.value) || 0))
            }
            onKeyDown={handleKeyDown}
            className="w-[52px] px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200
                       text-gray-900 text-[14px] font-bold text-center outline-none
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <span className="text-gray-400 text-[13px] font-semibold">ft</span>

          {/* Inches */}
          <input
            type="number"
            min={0}
            max={11}
            value={inches}
            onChange={(e) =>
              setInches(
                Math.max(0, Math.min(11, parseInt(e.target.value) || 0))
              )
            }
            onKeyDown={handleKeyDown}
            className="w-[44px] px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200
                       text-gray-900 text-[14px] font-bold text-center outline-none
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <span className="text-gray-400 text-[13px] font-semibold">in</span>

          {/* Fraction */}
          <select
            value={fraction}
            onChange={(e) => setFraction(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-[70px] px-1.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200
                       text-gray-900 text-[13px] font-semibold outline-none cursor-pointer
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {FRACTION_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f || "\u2014"}
              </option>
            ))}
          </select>

          {/* Confirm button */}
          <button
            onClick={handleSubmit}
            className="ml-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-bold
                       hover:bg-blue-500 transition-colors shadow-sm"
          >
            {"\u2713"}
          </button>
        </div>
        <div className="text-[9px] text-gray-400 mt-1.5 flex items-center gap-3">
          <span>Enter to confirm</span>
          <span>Esc to cancel</span>
          <span className="ml-auto text-gray-300">
            was: {edit.originalText}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── SVG Minimap ─── */

function SvgMinimap({
  svgContainerRef,
  wrapperEl,
  canvasW,
  canvasH,
}: {
  svgContainerRef: React.RefObject<HTMLDivElement | null>;
  wrapperEl: HTMLDivElement | null;
  canvasW: number;
  canvasH: number;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const { zoom, panX, panY } = useEditorStore();

  const aspect = canvasH / canvasW || 0.65;
  const miniH = Math.round(MINIMAP_W * aspect);

  useEffect(() => {
    const src = svgContainerRef.current?.querySelector("svg");
    const dest = thumbRef.current;
    if (!src || !dest) return;

    const clone = src.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", "100%");
    clone.setAttribute("height", "100%");
    clone.querySelectorAll("[data-dim-click]").forEach((el) => {
      (el as HTMLElement).style.cursor = "";
      (el as HTMLElement).style.pointerEvents = "none";
    });
    dest.innerHTML = "";
    dest.appendChild(clone);
  }, [svgContainerRef, canvasW, canvasH]);

  let vx = 0,
    vy = 0,
    vw = MINIMAP_W,
    vh = miniH;
  if (wrapperEl && canvasW && canvasH) {
    const wrapW = wrapperEl.clientWidth;
    const wrapH = wrapperEl.clientHeight;
    const cx = (canvasW * zoom) / 2 - (wrapW / 2 + panX);
    const cy = (canvasH * zoom) / 2 - (wrapH / 2 + panY);
    const s = MINIMAP_W / (canvasW * zoom);
    vx = cx * s;
    vy = cy * s;
    vw = wrapW * s;
    vh = wrapH * s;
  }

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasW || !canvasH) return;
      const bounds = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - bounds.left;
      const my = e.clientY - bounds.top;
      const s = MINIMAP_W / (canvasW * zoom);
      const clickCanvasX = mx / s;
      const clickCanvasY = my / s;
      const wrapEl = wrapperEl;
      if (!wrapEl) return;
      const newPanX = wrapEl.clientWidth / 2 - clickCanvasX;
      const newPanY = wrapEl.clientHeight / 2 - clickCanvasY;
      useEditorStore.getState().setPan(newPanX, newPanY);
    },
    [canvasW, canvasH, zoom, wrapperEl]
  );

  return (
    <div
      className="absolute bottom-14 left-3 z-20 rounded-lg overflow-hidden shadow-lg cursor-crosshair"
      style={{
        width: MINIMAP_W,
        height: miniH,
        border: "1.5px solid rgba(0,0,0,0.1)",
        background: "#fafafa",
      }}
      onClick={handleClick}
    >
      <div ref={thumbRef} className="w-full h-full" />
      <div
        className="absolute pointer-events-none"
        style={{
          left: Math.max(0, vx),
          top: Math.max(0, vy),
          width: Math.min(vw, MINIMAP_W),
          height: Math.min(vh, miniH),
          border: "1.5px solid rgba(37,99,235,0.6)",
          background: "rgba(37,99,235,0.08)",
        }}
      />
    </div>
  );
}

/* ================================================================
   MAIN COMPONENT -- SVG Drawing Canvas

   Black lines on white background via direct string replacement.
   Crisp vectors at any zoom via actual pixel dimensions (no CSS scale).
   Clickable dimension text with structured editor.
   Smooth zoom toward cursor, pan with drag threshold.
   Undo/redo, component overlays, minimap.
   ================================================================ */

export function SvgDrawingCanvas() {
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [svgLoaded, setSvgLoaded] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  // Track which dimension blocks have been modified (blockId -> {original, current})
  const modifiedDimsRef = useRef<
    Map<string, { original: string; current: string }>
  >(new Map());

  const {
    svgUrl,
    components,
    selectedId,
    hiddenComponents,
    zoom,
    panX,
    panY,
    originals,
    svgViewBox,
    stretchWarning,
    sheetType,
    currentSheet,
    select,
    setZoom,
    setPan,
    setSvgViewBox,
    setStretchWarning,
  } = useEditorStore();

  /* ─── Load SVG with direct color replacement ─── */
  useEffect(() => {
    if (!svgUrl) return;
    let cancelled = false;

    // Reset state for new SVG (sheet switch)
    setSvgLoaded(false);
    setDimsExtracted(false);
    modifiedDimsRef.current.clear();

    async function loadSvg() {
      try {
        // In dev, bypass the HTTP disk cache: the drawing SVG can be ~40MB and a
        // sandboxed dev browser may fail to cache it (ERR_CACHE_WRITE_FAILURE),
        // aborting the fetch. Prod keeps default caching (CDN-backed, fast reloads).
        const res = await fetch(
          svgUrl!,
          process.env.NODE_ENV === "production" ? undefined : { cache: "no-store" }
        );
        const svgText = await res.text();
        if (cancelled) return;

        const container = svgContainerRef.current;
        if (!container) return;

        // Process SVG: white->black strokes/fills for light background
        const fixedSvg = processLibreDwgSvg(svgText);

        container.innerHTML = fixedSvg;

        const svgEl = container.querySelector("svg");

        // Post-process DOM: hide annotations, filter layers, fix fills
        if (svgEl) {
          postProcessSvgDom(svgEl);
        }
        if (svgEl) {
          const viewBox = svgEl.getAttribute("viewBox");
          if (viewBox) {
            const parts = viewBox.split(/\s+/).map(Number);
            if (parts.length === 4) {
              setSvgSize({ w: parts[2], h: parts[3] });
              setSvgViewBox({
                minX: parts[0],
                minY: parts[1],
                width: parts[2],
                height: parts[3],
              });
            }
          }

          // SVG fills its container; real dimensions set by parent div
          svgEl.setAttribute("width", "100%");
          svgEl.setAttribute("height", "100%");
          svgEl.style.display = "block";

          setSvgLoaded(true);
          saveOriginalViewBox(svgEl);
          // P&ID sheets are not resizable: skip wiring clickable dimension blocks.
          if (sheetType !== "PID") {
            requestAnimationFrame(() => setupDimensionClicks(svgEl));
          }
        }
      } catch (err) {
        console.error("Failed to load SVG:", err);
      }
    }

    loadSvg();
    return () => {
      cancelled = true;
    };
  }, [svgUrl]);

  /* ─── Make dimension text clickable ─── */
  function setupDimensionClicks(svgEl: SVGSVGElement) {
    let count = 0;
    svgEl.querySelectorAll("use").forEach((useEl) => {
      const href = useEl.getAttribute("href") || "";
      if (!/^#\*D\d+$/.test(href)) return;

      const blockId = href.slice(1);
      const defBlock = svgEl.querySelector(`[id="${CSS.escape(blockId)}"]`);
      if (!defBlock) return;

      // Find dimension text inside this block
      let dimTextEl: SVGTextElement | null = null;
      let dimValue = "";
      for (const textEl of defBlock.querySelectorAll("text")) {
        const content = (textEl.textContent || "").trim();
        if (isDimensionText(content)) {
          dimTextEl = textEl as SVGTextElement;
          dimValue = content;
          break;
        }
      }
      if (!dimTextEl || !dimValue) return;

      // Walk up to find the parent <g> that contains this <use>
      const useGroup = useEl.closest("g") as SVGGElement | null;
      if (!useGroup) return;

      useGroup.style.cursor = "pointer";
      useGroup.setAttribute("data-dim-click", "true");
      useGroup.setAttribute("data-dim-block", blockId);
      count++;

      // Hover highlight
      useGroup.addEventListener("mouseenter", () => {
        useGroup.style.opacity = "0.6";
        useGroup.style.cursor = "pointer";
      });
      useGroup.addEventListener("mouseleave", () => {
        const isModified = modifiedDimsRef.current.has(blockId);
        useGroup.style.opacity = isModified ? "0.7" : "1";
      });

      // Click: open structured dimension editor
      useGroup.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        // Only open editor if mouse didn't move (not a drag)
        if (dragRef.current.moved) return;

        const wrapEl = wrapRef.current;
        if (!wrapEl) return;

        const groupRect = useGroup.getBoundingClientRect();
        const wrapRect = wrapEl.getBoundingClientRect();
        const currentValue = (dimTextEl!.textContent || "").trim();
        const parts = parseDimParts(currentValue || dimValue);

        setInlineEdit({
          x: groupRect.left - wrapRect.left + groupRect.width / 2 - 140,
          y: groupRect.top - wrapRect.top - 10,
          feet: parts.feet,
          inches: parts.inches,
          fraction: parts.fraction,
          originalText: currentValue || dimValue,
          textEl: dimTextEl!,
          useGroupEl: useGroup,
          blockId,
        });
      });
    });

    console.log(
      `[ELF] setupDimensionClicks: found ${count} clickable dimension blocks`
    );
  }

  /* ─── Extract dimensions from SVG to components ─── */
  function extractAndApplyDimensions(svgEl: SVGSVGElement) {
    const store = useEditorStore.getState();
    const comps = store.components;
    const compList = Object.values(comps);
    if (compList.length === 0) return;

    const dimGroups = svgEl.querySelectorAll("[data-dim-click]");
    if (dimGroups.length === 0) return;

    const dimEntries: {
      blockId: string;
      text: string;
      cx: number;
      cy: number;
      direction: "Height" | "Width";
    }[] = [];

    dimGroups.forEach((g) => {
      const blockId = g.getAttribute("data-dim-block") || "";
      const defBlock = svgEl.querySelector(`[id="${CSS.escape(blockId)}"]`);
      if (!defBlock) return;
      for (const textEl of defBlock.querySelectorAll("text")) {
        const content = (textEl.textContent || "").trim();
        if (!isDimensionText(content)) continue;
        const rect = (g as SVGGElement).getBoundingClientRect();
        dimEntries.push({
          blockId,
          text: content,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          direction: getDimBlockDirection(blockId, svgEl),
        });
        break;
      }
    });

    if (dimEntries.length === 0) return;

    const svgContainer = svgContainerRef.current;
    if (!svgContainer) return;
    const containerRect = svgContainer.getBoundingClientRect();

    const updatedComps = { ...comps };
    let changed = false;

    for (const comp of compList) {
      const [leftPct, topPct, widthPct, heightPct] = comp.box;
      const cx =
        containerRect.left +
        ((leftPct + widthPct / 2) / 100) * containerRect.width;
      const cy =
        containerRect.top +
        ((topPct + heightPct / 2) / 100) * containerRect.height;
      const size = Math.max(
        (widthPct / 100) * containerRect.width,
        (heightPct / 100) * containerRect.height
      );

      const searchRadius = Math.max(size * 1.5, 200);
      const nearbyDims = dimEntries
        .map((d) => ({
          ...d,
          dist: Math.hypot(d.cx - cx, d.cy - cy),
        }))
        .filter((d) => d.dist < searchRadius)
        .sort((a, b) => a.dist - b.dist);

      if (nearbyDims.length > 0) {
        const newDims: Record<string, string> = {};
        const newDimBlocks: Record<string, string> = {};
        if (comp.dims["X Position"])
          newDims["X Position"] = comp.dims["X Position"];
        if (comp.dims["Y Position"])
          newDims["Y Position"] = comp.dims["Y Position"];

        for (let i = 0; i < Math.min(nearbyDims.length, 3); i++) {
          const label = nearbyDims[i].direction;
          newDims[label] = nearbyDims[i].text;
          newDimBlocks[label] = nearbyDims[i].blockId;
        }

        const mainDimKey = newDims["Height"] ? "Height" : "Width";
        if (comp.dims["Rotation"])
          newDims["Rotation"] = comp.dims["Rotation"];

        updatedComps[comp.id] = {
          ...comp,
          dims: newDims,
          dimBlocks: newDimBlocks,
          mainDim: mainDimKey,
        };
        changed = true;
      }
    }

    if (changed) store.setComponents(updatedComps);
  }

  /* ─── AI-powered cascade analysis ─── */
  async function callAiCascade(
    compName: string,
    dimKey: string,
    oldValue: string,
    newValue: string
  ) {
    try {
      const store = useEditorStore.getState();
      const allComps = Object.values(store.components).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        dims: c.dims,
      }));

      const res = await fetch("/api/ai/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: `The user just changed ${compName}'s ${dimKey} from ${oldValue} to ${newValue}. What are the engineering cascade effects on other components? Apply any necessary changes.`,
          selectedComponent: allComps.find((c) => c.name === compName) ?? null,
          allComponents: allComps,
        }),
      });

      if (!res.ok) return;
      const data = await res.json();

      // Apply cascade effects from AI response. Validate every AI-supplied value
      // at the source: a non-positive / unparseable / garbage dimension would
      // collapse or garble the drawing, so drop it here rather than lean on the
      // stretch safety net to roll it back after the fact.
      for (const action of data.actions || []) {
        if (
          (action.action === "updateDim" || action.action === "cascade") &&
          action.componentId &&
          action.dimKey &&
          action.value
        ) {
          const check = validateDimValue(action.value);
          if (check.ok) {
            store.updateDim(action.componentId, action.dimKey, action.value);
          } else {
            console.warn(`[ELF] AI cascade rejected value: ${check.reason}`);
          }
        }
        if (action.cascadeEffects) {
          for (const effect of action.cascadeEffects) {
            const check = validateDimValue(effect.value);
            if (check.ok) {
              store.updateDim(effect.componentId, effect.dimKey, effect.value);
            } else {
              console.warn(`[ELF] AI cascade rejected value: ${check.reason}`);
            }
          }
        }
      }

      // Re-apply stretches after cascade updates
      const svgEl = svgContainerRef.current?.querySelector("svg");
      if (svgEl) {
        requestAnimationFrame(() => applyAllStretches(svgEl));
      }
    } catch (err) {
      console.warn("[ELF] AI cascade failed:", err);
    }
  }

  /* ─── Handle dimension editor submission ─── */
  function handleDimSubmit(newValue: string) {
    if (!inlineEdit) return;
    const { textEl, useGroupEl, originalText, blockId } = inlineEdit;
    const trimmed = newValue.trim();

    if (trimmed && trimmed !== originalText) {
      // Update the SVG text content to show new value
      textEl.textContent = trimmed;

      // Track modification for visual highlighting
      const existing = modifiedDimsRef.current.get(blockId);
      const original = existing?.original ?? originalText;
      if (trimmed === original) {
        modifiedDimsRef.current.delete(blockId);
        if (useGroupEl) useGroupEl.style.opacity = "1";
      } else {
        modifiedDimsRef.current.set(blockId, {
          original,
          current: trimmed,
        });
        if (useGroupEl) useGroupEl.style.opacity = "0.7";
      }

      // Flash confirmation
      if (useGroupEl) {
        useGroupEl.style.opacity = "0.4";
        setTimeout(() => {
          useGroupEl.style.opacity = modifiedDimsRef.current.has(blockId)
            ? "0.7"
            : "1";
        }, 400);
      }

      // Find closest component and update its dimension in the store
      const svgEl = svgContainerRef.current?.querySelector("svg");
      const svgContainer = svgContainerRef.current;
      if (svgEl && svgContainer && useGroupEl) {
        const groupRect = useGroupEl.getBoundingClientRect();
        const dimScreenCx = groupRect.left + groupRect.width / 2;
        const dimScreenCy = groupRect.top + groupRect.height / 2;
        const containerRect = svgContainer.getBoundingClientRect();

        let closestCompId: string | null = null;
        let closestDist = Infinity;

        for (const comp of Object.values(components)) {
          const [leftPct, topPct, widthPct, heightPct] = comp.box;
          const compCx =
            containerRect.left +
            ((leftPct + widthPct / 2) / 100) * containerRect.width;
          const compCy =
            containerRect.top +
            ((topPct + heightPct / 2) / 100) * containerRect.height;
          const dist = Math.hypot(dimScreenCx - compCx, dimScreenCy - compCy);
          const compSize = Math.max(
            (widthPct / 100) * containerRect.width,
            (heightPct / 100) * containerRect.height
          );
          const searchRadius = Math.max(compSize * 1.5, 200);

          if (dist < searchRadius && dist < closestDist) {
            closestDist = dist;
            closestCompId = comp.id;
          }
        }

        if (closestCompId) {
          const store = useEditorStore.getState();
          store.select(closestCompId);
          const dimKey = getDimBlockDirection(blockId, svgEl as SVGSVGElement);
          const comp = store.components[closestCompId];
          if (comp && blockId) {
            // Set the dimBlock mapping AND ensure the dim's current value matches
            // the original drawing text (not whatever the component had before).
            // This ensures updateDim's original-tracking captures the correct baseline.
            const updatedComp = {
              ...comp,
              dimBlocks: { ...comp.dimBlocks, [dimKey]: blockId },
              dims: { ...comp.dims, [dimKey]: originalText },
            };
            useEditorStore.setState({
              components: {
                ...store.components,
                [closestCompId]: updatedComp,
              },
            });
          }
          store.updateDim(closestCompId, dimKey, trimmed);

          // ─── VISUAL STRETCH: deform the drawing at the precise dimension zone ───
          requestAnimationFrame(() => {
            applyAllStretches(svgEl as SVGSVGElement);
          });

          // ─── AI CASCADE: ask AI what other components are affected ───
          callAiCascade(comp?.name ?? closestCompId, dimKey, originalText, trimmed);
        }
      }
    }

    setInlineEdit(null);
  }


  /**
   * Re-position component overlay boxes onto the real equipment. The AI pre-scan's
   * estimated boxes float off the drawing; instead union each component's dimension
   * blocks' real geometry (Model_Space) and convert to viewBox percentages. Runs once
   * per SVG load; components without dimBlocks keep their prior box.
   */
  function deriveComponentBoxes(svgEl: SVGSVGElement) {
    const vb = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number);
    if (!vb || vb.length !== 4) return;
    const [vbX, vbY, vbW, vbH] = vb;
    if (vbW <= 0 || vbH <= 0) return;

    const store = useEditorStore.getState();
    const comps = store.components;
    const updated: Record<string, ComponentDef> = {};
    let changed = false;

    for (const comp of Object.values(comps)) {
      const entries = comp.dimBlocks ? Object.entries(comp.dimBlocks) : [];
      if (entries.length === 0) continue;

      // Prefer each dim's on-axis MEASURED extent (a width dim's X, a height dim's Y)
      // — that is the feature's real edge, tight. The full block bbox would also
      // include the offset out to the dim line, bloating the overlay.
      let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity;
      let haveX = false,
        haveY = false;
      for (const [dimKey, blockId] of entries) {
        const dir = dimKeyToDirection(dimKey);
        if (dir === "horizontal") {
          const b = getDimBlockBounds(svgEl, blockId, "horizontal"); // X range
          if (b) {
            xMin = Math.min(xMin, b.min);
            xMax = Math.max(xMax, b.max);
            haveX = true;
          }
        } else if (dir === "vertical") {
          const b = getDimBlockBounds(svgEl, blockId, "vertical"); // internal Y range
          if (b) {
            yMin = Math.min(yMin, b.min);
            yMax = Math.max(yMax, b.max);
            haveY = true;
          }
        }
      }
      // Missing an axis (component dimensioned on only one axis): fall back to the
      // full 2D bbox of its blocks for the undetermined axis so the box still spans it.
      if (!haveX || !haveY) {
        let bx = Infinity,
          bX = -Infinity,
          by = Infinity,
          bY = -Infinity,
          any = false;
        for (const [, blockId] of entries) {
          const b = dimBlockBox2D(svgEl, blockId);
          if (!b) continue;
          bx = Math.min(bx, b.xMin);
          bX = Math.max(bX, b.xMax);
          by = Math.min(by, b.yMin);
          bY = Math.max(bY, b.yMax);
          any = true;
        }
        if (any) {
          if (!haveX) {
            xMin = bx;
            xMax = bX;
          }
          if (!haveY) {
            yMin = by;
            yMax = bY;
          }
        }
      }
      if (!isFinite(xMin) || !isFinite(yMin) || xMax <= xMin || yMax <= yMin)
        continue;

      // Model_Space (Y-up) -> viewBox (Y = -internalY): the top edge is -yMax.
      const leftPct = ((xMin - vbX) / vbW) * 100;
      const topPct = ((-yMax - vbY) / vbH) * 100;
      const widthPct = ((xMax - xMin) / vbW) * 100;
      const heightPct = ((yMax - yMin) / vbH) * 100;

      // Clamp so an overlay never spills past the drawing edge.
      const left = Math.max(0, Math.min(100, leftPct));
      const top = Math.max(0, Math.min(100, topPct));
      const box: [number, number, number, number] = [
        left,
        top,
        Math.max(0, Math.min(100 - left, widthPct)),
        Math.max(0, Math.min(100 - top, heightPct)),
      ];
      updated[comp.id] = { ...comp, box };
      changed = true;
    }

    if (changed) store.setComponents({ ...comps, ...updated });
  }

  /**
   * Recompute and apply ALL active stretches from the current originals/components state.
   * Uses the actual dimension block extension lines for precise zone definition.
   */
  function applyAllStretches(svgEl: SVGSVGElement) {
    const store = useEditorStore.getState();
    const currentOriginals = store.originals;
    const currentComps = store.components;

    // Clear any prior stretch warning before attempting a fresh apply.
    useEditorStore.getState().setStretchWarning(null);

    // Hide SVG during undo→reapply to prevent visible flash.
    // The undo resets all transforms (200ms), creating a frame of un-stretched drawing.
    // visibility:hidden prevents paint until we're done re-applying.
    svgEl.style.visibility = "hidden";

    // Reset to original geometry before re-applying all stretches
    undoStretches(svgEl);
    postProcessSvgDom(svgEl);
    saveOriginalViewBox(svgEl);

    // Parse viewBox for bounds conversion
    const vbAttr = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number);
    if (!vbAttr || vbAttr.length !== 4) {
      // The SVG was hidden above; never leave the canvas blank-and-silent. Restore
      // visibility and surface the generic warning instead of returning invisibly.
      svgEl.style.visibility = "";
      notifyStretchFailed("missing or malformed viewBox");
      return;
    }

    const modelSpace = findModelSpace(svgEl);
    const viewRegions = modelSpace ? computeViewRegions(modelSpace) : [];

    const stretches: StretchParams[] = [];
    const editedBlockIds = new Set<string>();

    for (const [compId, compOrig] of Object.entries(currentOriginals)) {
      const comp = currentComps[compId];
      if (!comp) continue;

      for (const [dimKey, origValue] of Object.entries(compOrig)) {
        const currentValue = comp.dims[dimKey];
        if (currentValue === origValue) continue;

        const dir = dimKeyToDirection(dimKey);
        if (!dir) continue;

        // Use the dimension block's extension lines for precise zone definition
        const blockId = comp.dimBlocks?.[dimKey];
        if (!blockId) continue;

        const dimBounds = getDimBlockBounds(svgEl, blockId, dir);
        if (!dimBounds) continue;

        // dimBounds are in Model_Space coords (Y-up for vertical, X-right for horizontal).
        const sectionSize = dimBounds.max - dimBounds.min;
        const delta = computeStretchDelta(origValue, currentValue, sectionSize);
        if (Math.abs(delta) < 0.01) continue;

        // Build svgBounds: the stretch zone in viewBox space.
        // For vertical: zone spans a Y range, full width.
        // For horizontal: zone spans an X range, full height.
        // viewBox Y = -(internal Y) due to the Y-flip matrix.
        let svgBounds;
        if (dir === "vertical") {
          svgBounds = {
            top: -dimBounds.max,       // viewBox Y is negated internal Y
            bottom: -dimBounds.min,
            left: vbAttr[0],
            right: vbAttr[0] + vbAttr[2],
          };
        } else {
          // Horizontal: dimBounds has X coords in Model_Space
          // X is NOT flipped (the matrix is (1,0,0,-1,0,0) — only Y flips)
          svgBounds = {
            top: vbAttr[1],
            bottom: vbAttr[1] + vbAttr[3],
            left: dimBounds.min,
            right: dimBounds.max,
          };
        }

        console.log(
          `[ELF stretch] queue ${comp.name} ${dimKey}: ${origValue} → ${currentValue}`,
          `dir=${dir} zone=[${dimBounds.min.toFixed(1)}, ${dimBounds.max.toFixed(1)}]`,
          `delta=${delta.toFixed(1)} sectionSize=${sectionSize.toFixed(1)}`
        );

        // Queue every changed dimension; they are composed together below, so a
        // section can grow on both axes and several sections can grow at once.
        let viewRegion: { xMin: number; xMax: number } | undefined;
        if (dir === "horizontal" && viewRegions.length > 1) {
          const dimX = (dimBounds.min + dimBounds.max) / 2; // width dim: dimBounds are X coords
          viewRegion = viewOf(dimX, viewRegions) ?? undefined;
        }
        // U2 2D scoping: confine this stretch's SCALING to the component's cross-axis
        // band (derived from real dim geometry) so it stops ovaling stacked neighbours.
        // Only scope when the component has a REAL cross-axis dim, so the band is its true
        // extent — NOT the stretch dim's short extension-line span, which would under-scale
        // the edit. Without one, leave crossBand undefined → today's full-band behaviour.
        const crossDir = dir === "horizontal" ? "vertical" : "horizontal";
        const hasCrossDim =
          !!comp.dimBlocks &&
          Object.keys(comp.dimBlocks).some((k) => dimKeyToDirection(k) === crossDir);
        const band = hasCrossDim
          ? computeComponentBand(comp.dimBlocks, svgEl, dir === "horizontal" ? "x" : "y")
          : null;
        stretches.push({
          componentId: compId,
          svgBounds,
          direction: dir,
          delta,
          viewRegion,
          crossBand: band ? { lo: band.crossBand[0], hi: band.crossBand[1] } : undefined,
        });
        editedBlockIds.add(blockId);

        // Keep the governing dim's number on the drawing in sync with the store.
        // Inline edits write the SVG text directly; AI-cascade edits only update
        // the store, so without this the governing number could stay stale.
        setDimBlockText(svgEl, blockId, origValue, currentValue);
      }
    }

    // A simultaneous total+component edit (e.g. overall 50'→54' AND silencer
    // 8'→10') nests: convert each container's delta to its residual so the growth
    // its children already produce isn't double-counted (else the total overshoots,
    // and the same double-count would hit the spanning re-value below). Disjoint
    // component-only edits (the common case) pass through unchanged.
    // U4 safety-net: a HIGH-confidence detached detail sharing an actively-scaling
    // cross-band can't be held rigid by the crossBand engine (which holds cross-SEPARATED
    // details for free but not shared-band ones), so warn for manual review. On the real
    // drawings U3 is low-confidence (the skid is cross-separated + tiny), so no spurious
    // warning fires; this only triggers for a hypothetical large shared-band detail.
    let detachedWarn = false;
    if (modelSpace) {
      const highConf = detectDetachedAssemblies(modelSpace).filter(
        (d) => d.confidence >= CONF_MIN
      );
      detachedWarn = highConf.some((d) =>
        stretches.some((s) => {
          if (!s.crossBand) return false;
          const cross =
            s.direction === "horizontal"
              ? (d.bbox.yMin + d.bbox.yMax) / 2
              : (d.bbox.xMin + d.bbox.xMax) / 2;
          return cross >= s.crossBand.lo && cross <= s.crossBand.hi;
        })
      );
    }

    const resolved = resolveContainerResiduals(stretches);

    // Compose all queued stretches in a single pass (multi-dimension, multi-section).
    // The engine is self-guarding: on any watchdog/invariant failure it rolls the
    // geometry back to known-good and returns ok:false. Never leave a corrupt drawing.
    const result = applyMultiStretch(svgEl, resolved);
    if (!result.ok) {
      undoStretches(svgEl);          // belt-and-suspenders: guarantee known-good geometry
      postProcessSvgDom(svgEl);
      svgEl.style.visibility = "";
      notifyStretchFailed(result.reason ?? "unknown");
      return;                         // do NOT re-value dims off a rolled-back geometry
    }

    // Re-value the spanning totals the stretch grew (e.g. overall 50'→54'); the
    // governing dims are already set by the edit that triggered this pass. Uses the
    // SAME resolved deltas as the geometry so a dim spanning both overall+component
    // adds the true growth, not the double-counted sum.
    revalueSpanningDims(svgEl, resolved, editedBlockIds);

    // U4: the stretch applied cleanly, but flag a shared-band detached detail for review.
    if (detachedWarn) {
      useEditorStore
        .getState()
        .setStretchWarning("Detached details present — review manually.");
    }

    // Show SVG after all transforms are applied (prevents flash)
    svgEl.style.visibility = "";
  }

  /**
   * Write a dimension block's number on the drawing from the store value,
   * undo-safe. Records the true original in data-revalue-orig (which undoStretches
   * restores) even when the text already matches, so an inline edit that wrote the
   * number directly still reverts on undo.
   */
  function setDimBlockText(
    svgEl: SVGSVGElement,
    blockId: string,
    originalValue: string,
    newValue: string
  ) {
    const block = svgEl.querySelector(`[id="${CSS.escape(blockId)}"]`);
    if (!block) return;
    for (const textEl of block.querySelectorAll("text")) {
      const cur = (textEl.textContent || "").trim();
      if (!isDimensionText(cur)) continue;
      if (!textEl.hasAttribute("data-revalue-orig")) {
        textEl.setAttribute("data-revalue-orig", originalValue);
      }
      if (cur !== newValue) textEl.textContent = newValue;
      return;
    }
  }

  /**
   * Re-value the dimensions whose measured span the stretch grew. Mirrors the
   * lab's modify.mjs rule: a same-axis dimension is bumped by +delta only if it
   * SPANS the stretched section (its measured range contains the stretch zone) —
   * e.g. stretching the silencer grows the overall-height total. The governing
   * (directly edited) dims already carry their new value and are skipped. Dims
   * that merely clip a zone edge (typically an unrelated companion-elevation dim)
   * are left alone, which is the sales-correct, conservative set.
   *
   * Only the SVG def text is written (the rendered drawing is the deliverable).
   * undoStretches() restores it via the data-revalue-orig marker, so repeated
   * passes and undo stay consistent and chained edits recompute from original.
   */
  function revalueSpanningDims(
    svgEl: SVGSVGElement,
    stretches: StretchParams[],
    editedBlockIds: Set<string>
  ) {
    if (stretches.length === 0) return;

    // Normalize each stretch to a Model_Space span along its axis.
    const specs = stretches.map((s) =>
      s.direction === "vertical"
        ? { dir: "vertical" as const, lo: -s.svgBounds.bottom, hi: -s.svgBounds.top, delta: s.delta }
        : { dir: "horizontal" as const, lo: s.svgBounds.left, hi: s.svgBounds.right, delta: s.delta }
    );

    const TOL = 6; // inches — matches the lab's spanning tolerance
    const defBlocks = svgEl.querySelectorAll('[id^="*D"]');

    for (const block of defBlocks) {
      const blockId = block.getAttribute("id") || "";
      if (!/^\*D\d+$/.test(blockId)) continue;
      if (editedBlockIds.has(blockId)) continue; // governing dim already set by the edit

      const dir =
        getDimBlockDirection(blockId, svgEl) === "Height" ? "vertical" : "horizontal";
      const bounds = getDimBlockBounds(svgEl, blockId, dir);
      if (!bounds) continue;

      // Sum the deltas of same-axis stretches this dimension fully spans.
      let add = 0;
      for (const sp of specs) {
        if (sp.dir !== dir) continue;
        if (bounds.min <= sp.lo + TOL && bounds.max >= sp.hi - TOL) add += sp.delta;
      }
      if (Math.abs(add) < 0.01) continue;

      for (const textEl of block.querySelectorAll("text")) {
        const cur = (textEl.textContent || "").trim();
        if (!isDimensionText(cur)) continue;
        const curInches = parseDimInches(cur);
        if (curInches == null) break;
        if (!textEl.hasAttribute("data-revalue-orig")) {
          textEl.setAttribute("data-revalue-orig", cur);
        }
        const nv = formatDimInches(curInches + add);
        textEl.textContent = nv;
        console.log(`[ELF revalue] ${blockId} ${cur} → ${nv} (+${add.toFixed(1)} spanning)`);
        break;
      }
    }
  }

  /* ─── Highlight modified dimensions in the SVG ─── */
  useEffect(() => {
    if (!svgLoaded) return;
    const svgEl = svgContainerRef.current?.querySelector("svg");
    if (!svgEl) return;

    for (const [compId, compOrig] of Object.entries(originals)) {
      const comp = components[compId];
      if (!comp) continue;
      for (const [dimKey, origValue] of Object.entries(compOrig)) {
        const currentValue = comp.dims[dimKey];
        const blockId = comp.dimBlocks?.[dimKey];
        if (!blockId) continue;

        const useGroup = svgEl.querySelector(
          `[data-dim-block="${CSS.escape(blockId)}"]`
        ) as SVGGElement | null;
        if (!useGroup) continue;

        if (currentValue !== origValue) {
          useGroup.style.opacity = "0.7";
          modifiedDimsRef.current.set(blockId, {
            original: origValue,
            current: currentValue,
          });
        } else {
          useGroup.style.opacity = "1";
          modifiedDimsRef.current.delete(blockId);
        }
      }
    }

    // Apply visual stretches for dimension changes from AI configurator / undo-redo
    // Only run when there are tracked originals (dimension edits have occurred)
    if (Object.keys(originals).length > 0) {
      const hasChanges = Object.entries(originals).some(([id, orig]) => {
        const c = components[id];
        return c && Object.entries(orig).some(([k, v]) => c.dims[k] !== v);
      });
      if (hasChanges) {
        applyAllStretches(svgEl);
      } else {
        // All dims restored to original — reset geometry
        undoStretches(svgEl);
        postProcessSvgDom(svgEl);
      }
    }
  }, [originals, components, svgLoaded]);

  /* ─── Extract real dimensions from SVG after load ─── */
  const [dimsExtracted, setDimsExtracted] = useState(false);
  useEffect(() => {
    if (!svgLoaded || dimsExtracted) return;
    const timer = requestAnimationFrame(() => {
      const svgEl = svgContainerRef.current?.querySelector("svg");
      if (svgEl) {
        const comps = useEditorStore.getState().components;
        const hasDimBlocks = Object.values(comps).some(
          (c) => c.dimBlocks && Object.keys(c.dimBlocks).length > 0
        );
        if (hasDimBlocks) {
          // AI sections already carry a semantic dim->block mapping; keep those dims
          // and only re-position the overlay boxes onto the real drawing geometry.
          deriveComponentBoxes(svgEl);
        } else {
          // Fallback (raw DWG blocks, no dim mapping): match nearby dims by proximity.
          extractAndApplyDimensions(svgEl);
        }
        setDimsExtracted(true);
      }
    });
    return () => cancelAnimationFrame(timer);
  }, [svgLoaded, dimsExtracted]);

  /* ─── Auto zoom-fit ─── */
  useEffect(() => {
    if (!svgSize.w || !svgSize.h) return;
    const wrap = wrapRef.current;
    if (!wrap || !wrap.clientWidth) return;
    const sx = (wrap.clientWidth - 40) / svgSize.w;
    const sy = (wrap.clientHeight - 40) / svgSize.h;
    const store = useEditorStore.getState();
    store.setZoom(Math.min(sx, sy));
    store.setPan(0, 0);
  }, [svgSize]);

  /* ─── Zoom-fit helper ─── */
  const zoomFit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !svgSize.w || !svgSize.h) return;
    const sx = (wrap.clientWidth - 40) / svgSize.w;
    const sy = (wrap.clientHeight - 40) / svgSize.h;
    setZoom(Math.min(sx, sy));
    setPan(0, 0);
  }, [setZoom, setPan, svgSize]);

  /* ─── Smooth wheel zoom toward cursor ─── */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = svgSize;
      if (!w || !h) return;

      const state = useEditorStore.getState();
      const oldZoom = state.zoom;
      const oldPanX = state.panX;
      const oldPanY = state.panY;

      const isPinch = e.ctrlKey;
      const factor = isPinch
        ? 1 - e.deltaY * 0.01
        : e.deltaY < 0
          ? 1.12
          : 0.89;

      const newZoom = Math.max(0.05, Math.min(8, oldZoom * factor));

      // Zoom toward cursor: find the canvas point under cursor, keep it there
      const rect = wrap.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Canvas point under cursor (in unscaled SVG units)
      const canvasX =
        (cursorX - rect.width / 2 - oldPanX + (w * oldZoom) / 2) / oldZoom;
      const canvasY =
        (cursorY - rect.height / 2 - oldPanY + (h * oldZoom) / 2) / oldZoom;

      // New pan to keep that canvas point under cursor
      const newPanX =
        cursorX - rect.width / 2 - canvasX * newZoom + (w * newZoom) / 2;
      const newPanY =
        cursorY - rect.height / 2 - canvasY * newZoom + (h * newZoom) / 2;

      state.setZoom(newZoom);
      state.setPan(newPanX, newPanY);
    };

    wrap.addEventListener("wheel", handler, { passive: false });
    return () => wrap.removeEventListener("wheel", handler);
  }, [svgSize]);

  /* ─── Pan with drag (5px threshold) ─── */
  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (
      target.closest("[data-comp-overlay]") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("[data-dim-editor]") ||
      target.closest("button")
    )
      return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX - panX,
      startY: e.clientY - panY,
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.originX;
      const dy = e.clientY - dragRef.current.originY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
      }
      setPan(
        e.clientX - dragRef.current.startX,
        e.clientY - dragRef.current.startY
      );
    };
    const onUp = () => {
      dragRef.current.dragging = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setPan]);

  /* ─── Keyboard shortcuts (undo/redo) ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ─── Compute change indicators for overlays ─── */
  function getChangeInfo(compId: string): {
    hasChange: boolean;
    changes: { dimKey: string; direction: string; pctChange: number }[];
  } {
    const compOrig = originals[compId];
    if (!compOrig) return { hasChange: false, changes: [] };
    const comp = components[compId];
    if (!comp) return { hasChange: false, changes: [] };

    const changes: {
      dimKey: string;
      direction: string;
      pctChange: number;
    }[] = [];

    for (const [dimKey, origValue] of Object.entries(compOrig)) {
      const currentValue = comp.dims[dimKey];
      if (currentValue === origValue) continue;

      const origInches = parseDimInches(origValue);
      const newInches = parseDimInches(currentValue);
      if (!origInches || !newInches || origInches === 0) continue;

      const pctChange = ((newInches - origInches) / origInches) * 100;
      const dir = dimKeyToDirection(dimKey);
      changes.push({
        dimKey,
        direction: dir || "vertical",
        pctChange,
      });
    }

    return { hasChange: changes.length > 0, changes };
  }

  // Crisp vector rendering: actual pixel dimensions, NO CSS scale()
  const { w, h } = svgSize;
  const realW = w * zoom;
  const realH = h * zoom;
  const translateX = panX - realW / 2;
  const translateY = panY - realH / 2;

  const historyIndex = useEditorStore.getState().historyIndex;
  const historyLength = useEditorStore.getState().history.length;

  return (
    <div
      ref={wrapRef}
      className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ background: "#f0f0f4" }}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        const target = e.target as Element;
        if (target.closest("[data-comp-overlay]")) return;
        if (target.closest("input")) return;
        if (target.closest("select")) return;
        if (target.closest("[data-dim-click]")) return;
        if (target.closest("[data-dim-editor]")) return;
        if (target.closest("button")) return;
        if (dragRef.current.moved) return;
        select(null);
      }}
    >
      {/* Stretch-failure warning banner (drawing was rolled back, left unchanged) */}
      {stretchWarning && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3
                     px-4 py-2 rounded-xl bg-amber-50 border border-amber-300
                     text-amber-800 text-[12px] font-medium shadow-md"
          role="alert"
        >
          <span>{stretchWarning}</span>
          <button
            onClick={() => setStretchWarning(null)}
            aria-label="Dismiss warning"
            className="text-amber-500 hover:text-amber-800 transition-colors leading-none text-[14px]"
          >
            {"✕"}
          </button>
        </div>
      )}

      {/* P&ID sheets are not resizable: static badge, no dismiss */}
      {sheetType === "PID" && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl
                      bg-slate-100 border border-slate-300 text-slate-600 text-[12px] font-semibold shadow-md"
        >
          {"P&ID — not resizable"}
        </div>
      )}

      {/* SVG drawing + component overlays */}
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          transform: `translate(${translateX}px, ${translateY}px)`,
          width: realW || "auto",
          height: realH || "auto",
        }}
      >
        {/* SVG container -- black lines on white */}
        <div
          ref={svgContainerRef}
          className="absolute inset-0"
          style={{
            background: "white",
            boxShadow: "0 1px 12px rgba(0,0,0,0.1)",
          }}
        />

        {/* Component region overlays */}
        {svgLoaded && w > 0 && (
          <div
            className="absolute inset-0"
            style={{ pointerEvents: "none" }}
          >
            {Object.values(components)
              .filter((comp) => !hiddenComponents.has(comp.id))
              .map((comp) => {
              const isSelected = comp.id === selectedId;
              const { hasChange, changes } = getChangeInfo(comp.id);

              return (
                <div
                  key={comp.id}
                  data-comp-overlay
                  onClick={(e) => {
                    e.stopPropagation();
                    select(comp.id);
                  }}
                  style={{
                    position: "absolute",
                    left: `${comp.box[0]}%`,
                    top: `${comp.box[1]}%`,
                    width: `${comp.box[2]}%`,
                    height: `${comp.box[3]}%`,
                    border: isSelected
                      ? `2px solid ${comp.color}`
                      : hasChange
                        ? `2px dashed ${comp.color}cc`
                        : `1.5px solid ${comp.color}40`,
                    background: isSelected
                      ? `${comp.color}18`
                      : hasChange
                        ? `${comp.color}0c`
                        : `${comp.color}05`,
                    boxShadow: isSelected
                      ? `0 0 16px ${comp.color}30, inset 0 0 20px ${comp.color}08`
                      : "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    pointerEvents: "auto",
                    transition:
                      "border 0.2s, background 0.2s, box-shadow 0.2s",
                    zIndex: isSelected ? 5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.border = `2px solid ${comp.color}88`;
                      e.currentTarget.style.background = `${comp.color}12`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.border = hasChange
                        ? `2px dashed ${comp.color}cc`
                        : `1.5px solid ${comp.color}40`;
                      e.currentTarget.style.background = hasChange
                        ? `${comp.color}0c`
                        : `${comp.color}05`;
                    }
                  }}
                >
                  {/* Component label */}
                  <div
                    className="text-[10px] font-bold tracking-wide whitespace-nowrap pointer-events-none"
                    style={{
                      position: "absolute",
                      top: 3,
                      left: 5,
                      color: comp.color,
                      textShadow:
                        "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.6)",
                      opacity: 0.9,
                    }}
                  >
                    {comp.name}
                  </div>

                  {/* Change indicator badges */}
                  {hasChange &&
                    changes.map((ch, i) => (
                      <div
                        key={i}
                        className="absolute text-[9px] font-bold rounded-full px-2 py-0.5 pointer-events-none"
                        style={{
                          top: -10,
                          right: i * 60 - 4,
                          background:
                            ch.pctChange > 0 ? "#16a34a" : "#dc2626",
                          color: "white",
                          boxShadow: `0 1px 6px ${ch.pctChange > 0 ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)"}`,
                        }}
                      >
                        {ch.direction === "vertical"
                          ? ch.pctChange > 0
                            ? "\u2191"
                            : "\u2193"
                          : ch.pctChange > 0
                            ? "\u2192"
                            : "\u2190"}{" "}
                        {Math.abs(Math.round(ch.pctChange))}%
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Red markup overlay (line/arrow/text annotations) — sibling INSIDE
            the same zoom/pan-transformed wrapper so it inherits the drawing's
            transform for free. Mounted after the drawing + component overlays
            so it stacks on top. All sheets (GA + P&ID), independent of the
            resize gate. */}
        {svgLoaded && svgViewBox && (
          <MarkupOverlay
            viewBox={`${svgViewBox.minX} ${svgViewBox.minY} ${svgViewBox.width} ${svgViewBox.height}`}
            sheetNumber={currentSheet}
          />
        )}
      </div>

      {/* Structured dimension editor */}
      {inlineEdit && (
        <DimensionEditor
          edit={inlineEdit}
          onSubmit={handleDimSubmit}
          onCancel={() => setInlineEdit(null)}
        />
      )}

      {/* Loading state */}
      {!svgUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="text-gray-300 text-4xl">{"\uD83D\uDCD0"}</div>
          <div className="text-gray-400 text-sm font-medium">
            No DWG drawing loaded
          </div>
        </div>
      )}

      {/* Floating controls */}
      <div className="absolute top-3 left-3 flex gap-1 z-10">
        {[
          {
            label: "+",
            action: () => setZoom(useEditorStore.getState().zoom * 1.25),
          },
          {
            label: "\u2212",
            action: () => setZoom(useEditorStore.getState().zoom * 0.8),
          },
          { label: "\u21F2", action: zoomFit },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            className="w-[32px] h-[32px] rounded-lg bg-white/95
                       border border-gray-200 text-gray-500 flex items-center justify-center
                       text-[14px] hover:bg-white hover:text-gray-800
                       hover:border-gray-300 transition-all shadow-sm"
          >
            {btn.label}
          </button>
        ))}

        {/* Undo / Redo */}
        <div className="ml-2 flex gap-1">
          <button
            onClick={() => useEditorStore.getState().undo()}
            className="w-[32px] h-[32px] rounded-lg bg-white/95
                       border border-gray-200 text-gray-500 flex items-center justify-center
                       text-[13px] hover:bg-white hover:text-gray-800
                       hover:border-gray-300 transition-all shadow-sm
                       disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={historyIndex < 0}
            title="Undo (\u2318Z)"
          >
            {"\u21B6"}
          </button>
          <button
            onClick={() => useEditorStore.getState().redo()}
            className="w-[32px] h-[32px] rounded-lg bg-white/95
                       border border-gray-200 text-gray-500 flex items-center justify-center
                       text-[13px] hover:bg-white hover:text-gray-800
                       hover:border-gray-300 transition-all shadow-sm
                       disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={historyIndex >= historyLength - 1}
            title="Redo (\u2318\u21E7Z)"
          >
            {"\u21B7"}
          </button>
        </div>
      </div>

      {/* SVG Minimap */}
      {svgLoaded && w > 0 && (
        <SvgMinimap
          svgContainerRef={svgContainerRef}
          wrapperEl={wrapRef.current}
          canvasW={w}
          canvasH={h}
        />
      )}

      {/* Zoom indicator */}
      <div
        className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-lg
                     bg-white/90 border border-gray-200 text-gray-500
                     text-[11px] font-semibold z-10 shadow-sm"
      >
        {Math.round(zoom * 100)}%
      </div>

      {/* Instructions hint */}
      {svgLoaded &&
        !selectedId &&
        !inlineEdit &&
        Object.keys(originals).length === 0 && (
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10
                     px-4 py-2 rounded-xl bg-blue-50 border border-blue-200
                     text-blue-600/70 text-[11px] font-medium shadow-sm"
          >
            Click any dimension text on the drawing to edit · Scroll to zoom
            · Drag to pan
          </div>
        )}
    </div>
  );
}
