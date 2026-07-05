/**
 * Component extraction pipeline.
 *
 * Transforms raw DWG INSERT entities into structured DwgComponents
 * by analyzing block names, attribute tags, positions, and scales.
 */

import type {
  DwgBlockDef,
  DwgComponent,
  DwgInsert,
  DwgParseResult,
  DwgSheet,
} from "./types";
import type { ComponentDef } from "@/stores/editor-store";

/** Block names that represent drawing infrastructure, not real components */
const INFRASTRUCTURE_BLOCKS = new Set([
  "Borders ELC-D",
  "Title Blocks ELC-GA",
  "THIRD ANGLE PROJECTION",
  "2dTransSection0",
  "Datum Identifier1",
  "DatumFilled45",
  "Filled-1",
  "_Closed",
  "DESIGN STATE",
  "PRELIMINARY ISSUE",
  "Perf Puddle",
]);

/** Base colors for component categories */
const CATEGORY_COLORS: Record<string, string> = {
  nozzle: "#e74c3c",
  centerline: "#3498db",
  flow: "#27ae60",
  default: "#9b59b6",
};

/** Distinct color palette for individual components within a category.
 *  Each component gets a unique color so overlays are distinguishable. */
const SECTION_COLORS = [
  "#3498db", "#e67e22", "#2ecc71", "#e74c3c", "#9b59b6",
  "#1abc9c", "#f39c12", "#2980b9", "#d35400", "#27ae60",
  "#8e44ad", "#16a085", "#c0392b", "#2c3e50", "#f1c40f",
];

const NOZZLE_COLORS = [
  "#e74c3c", "#ff6b6b", "#c0392b", "#e55039", "#ff4757",
  "#fc5c65", "#eb3b5a", "#d63031", "#ff6348", "#ee5a24",
  "#e84118", "#ff7675", "#fd79a8", "#e17055", "#d35400",
];

let sectionColorIdx = 0;
let nozzleColorIdx = 0;

/** Icons for component categories */
const CATEGORY_ICONS: Record<string, string> = {
  nozzle: "N",
  centerline: "CL",
  flow: "F",
  default: "C",
};

/** Extract components from parsed DWG data */
export function extractComponents(parseResult: DwgParseResult): DwgComponent[] {
  const { inserts, blocks } = parseResult;
  const blockMap = new Map(blocks.map((b) => [b.name, b]));
  const components: DwgComponent[] = [];

  for (const insert of inserts) {
    // Skip infrastructure blocks
    if (INFRASTRUCTURE_BLOCKS.has(insert.blockName)) continue;

    const block = blockMap.get(insert.blockName);
    const category = categorizeBlock(insert.blockName);

    // Build attribs map
    const attribMap: Record<string, string> = {};
    for (const a of insert.attribs) {
      attribMap[a.tag] = a.text;
    }

    // Determine label from attribs or block name
    const label = deriveLabel(insert, category);
    const nozzleId = category === "nozzle" ? (insert.attribs[0]?.tag ?? null) : null;

    components.push({
      id: `dwg-${insert.handle}`,
      blockName: insert.blockName,
      label,
      nozzleId,
      position: insert.insertionPoint,
      scale: {
        x: insert.xScale,
        y: insert.yScale,
        z: insert.zScale,
      },
      rotation: insert.rotation,
      layer: insert.layer,
      attribs: attribMap,
    });
  }

  return components;
}

/** Convert DwgComponents to editor ComponentDefs for the UI */
export function toEditorComponents(
  dwgComponents: DwgComponent[],
  svgViewBox: { minX?: number; minY?: number; width: number; height: number }
): Record<string, ComponentDef> {
  const result: Record<string, ComponentDef> = {};
  const vbMinX = svgViewBox.minX ?? 0;
  const vbMinY = svgViewBox.minY ?? 0;

  // Sort centerline components by X position to compute section spans
  const centerlines = dwgComponents
    .filter((c) => categorizeBlock(c.blockName) === "centerline")
    .sort((a, b) => a.position.x - b.position.x);

  // Separate nozzles for computing vertical extents per section
  const nozzles = dwgComponents.filter(
    (c) => categorizeBlock(c.blockName) === "nozzle"
  );

  // Detect the view boundary: the drawing has two views (front + section).
  // Look for a gap in X positions — the largest gap between sorted component
  // X values likely separates the two views.
  const allXPositions = dwgComponents
    .map((c) => c.position.x)
    .sort((a, b) => a - b);
  let viewBoundaryX = vbMinX + svgViewBox.width / 2; // default to midpoint
  if (allXPositions.length > 2) {
    let maxGap = 0;
    for (let i = 1; i < allXPositions.length; i++) {
      const gap = allXPositions[i] - allXPositions[i - 1];
      if (gap > maxGap) {
        maxGap = gap;
        viewBoundaryX = (allXPositions[i] + allXPositions[i - 1]) / 2;
      }
    }
  }

  // Precompute section regions for centerline components
  // Each centerline marks a section; its region spans from its X to the next centerline's X
  const sectionRegions = new Map<string, { left: number; right: number; top: number; bottom: number }>();
  for (let i = 0; i < centerlines.length; i++) {
    const cl = centerlines[i];
    // Determine which view this centerline belongs to
    const isLeftView = cl.position.x < viewBoundaryX;
    const viewLeft = isLeftView ? vbMinX : viewBoundaryX;
    const viewRight = isLeftView ? viewBoundaryX : vbMinX + svgViewBox.width;

    // Horizontal span: midpoint to neighbors, but clamped to this view
    const sameViewCenterlines = centerlines.filter(
      (c) => (c.position.x < viewBoundaryX) === isLeftView
    );
    const idx = sameViewCenterlines.indexOf(cl);
    const prevX = idx > 0 ? sameViewCenterlines[idx - 1].position.x : viewLeft;
    const nextX = idx < sameViewCenterlines.length - 1
      ? sameViewCenterlines[idx + 1].position.x
      : viewRight;
    const left = Math.max(viewLeft, (cl.position.x + prevX) / 2);
    const right = Math.min(viewRight, (cl.position.x + nextX) / 2);

    // Vertical span: find nozzles within this section's horizontal range
    // and use their Y extent + padding, instead of a fixed 35% of drawing height
    const sectionNozzles = nozzles.filter(
      (n) => n.position.x >= left && n.position.x <= right
    );
    let top: number, bottom: number;
    if (sectionNozzles.length > 0) {
      const nozzleYs = sectionNozzles.map((n) => n.position.y);
      const minNozzleY = Math.min(...nozzleYs);
      const maxNozzleY = Math.max(...nozzleYs);
      const yRange = maxNozzleY - minNozzleY;
      const padding = Math.max(yRange * 0.3, 20); // 30% padding or minimum 20 units
      top = minNozzleY - padding;
      bottom = maxNozzleY + padding;
    } else {
      // No nozzles in range — use a modest span around the centerline position
      const modestSpan = svgViewBox.height * 0.12;
      top = cl.position.y - modestSpan;
      bottom = cl.position.y + modestSpan;
    }

    sectionRegions.set(cl.id, { left, right, top, bottom });
  }

  // Reset color indices for each extraction
  sectionColorIdx = 0;
  nozzleColorIdx = 0;

  for (const comp of dwgComponents) {
    const category = categorizeBlock(comp.blockName);
    // Assign a unique color per component from the category's palette
    let color: string;
    if (category === "centerline") {
      color = SECTION_COLORS[sectionColorIdx % SECTION_COLORS.length];
      sectionColorIdx++;
    } else if (category === "nozzle") {
      color = NOZZLE_COLORS[nozzleColorIdx % NOZZLE_COLORS.length];
      nozzleColorIdx++;
    } else {
      color = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
    }
    const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.default;

    // Convert DWG coordinates to percentage-based bounding box
    const box = computeBoundingBox(comp, svgViewBox, vbMinX, vbMinY, sectionRegions);

    // Build dimensions from scale and position
    const dims: Record<string, string> = {};
    dims["X Position"] = `${comp.position.x.toFixed(1)}`;
    dims["Y Position"] = `${comp.position.y.toFixed(1)}`;
    dims["X Scale"] = `${comp.scale.x}`;
    dims["Y Scale"] = `${comp.scale.y}`;
    if (comp.rotation !== 0) {
      dims["Rotation"] = `${((comp.rotation * 180) / Math.PI).toFixed(1)}°`;
    }
    // Add all attribs as dims
    for (const [key, val] of Object.entries(comp.attribs)) {
      dims[key] = val;
    }

    result[comp.id] = {
      id: comp.id,
      name: comp.label,
      type: category,
      color,
      icon,
      box,
      dims,
      dimBlocks: {},
      mainDim: "X Scale",
      constraints: [],
      downstream: [],
      upstream: [],
      notes: comp.nozzleId
        ? `Nozzle ${comp.nozzleId} — ${comp.blockName}`
        : comp.blockName,
    };
  }

  // Build upstream/downstream relationships based on spatial proximity
  buildRelationships(result, dwgComponents);

  return result;
}

function categorizeBlock(blockName: string): string {
  if (blockName === "CriticalFeature") return "nozzle";
  if (blockName.startsWith("CENTER LINE")) return "centerline";
  if (blockName.includes("FLOW")) return "flow";
  return "default";
}

function deriveLabel(insert: DwgInsert, category: string): string {
  const firstAttrib = insert.attribs[0]?.tag;

  if (category === "nozzle" && firstAttrib) {
    return `Nozzle ${firstAttrib}`;
  }
  if (category === "centerline" && firstAttrib) {
    return firstAttrib;
  }
  if (category === "flow") {
    return insert.blockName.replace(/-/g, " ");
  }
  return insert.blockName;
}

function computeBoundingBox(
  comp: DwgComponent,
  viewBox: { width: number; height: number },
  vbMinX: number,
  vbMinY: number,
  sectionRegions: Map<string, { left: number; right: number; top: number; bottom: number }>
): [number, number, number, number] {
  if (viewBox.width === 0 || viewBox.height === 0) {
    return [0, 0, 1, 1];
  }

  const category = categorizeBlock(comp.blockName);

  // SVG viewBox has Y-axis inverted (minY is top in SVG but high Y values in DWG).
  // DWG Y increases upward; SVG Y increases downward.
  // SVG viewBox: minX, minY, width, height. Point mapping:
  //   svgX = dwgX
  //   svgY = -(dwgY)  [LibreDWG flips Y when generating SVG]
  // So percentage in SVG space:
  //   leftPct = (dwgX - vbMinX) / vbWidth * 100
  //   topPct  = (-dwgY - vbMinY) / vbHeight * 100

  if (category === "centerline") {
    // Use precomputed section region (already view-constrained)
    const region = sectionRegions.get(comp.id);
    if (region) {
      const leftPct = ((region.left - vbMinX) / viewBox.width) * 100;
      const topPct = ((-region.bottom - vbMinY) / viewBox.height) * 100;
      const widthPct = ((region.right - region.left) / viewBox.width) * 100;
      const heightPct = ((region.bottom - region.top) / viewBox.height) * 100;
      return [
        clampPct(leftPct),
        clampPct(topPct),
        Math.min(100 - clampPct(leftPct), Math.max(1, widthPct)),
        Math.min(100 - clampPct(topPct), Math.max(1, heightPct)),
      ];
    }
  }

  // For nozzles and other point-like components: small box around position
  const size = category === "nozzle" ? 30 : 20;
  const leftPct = ((comp.position.x - size / 2 - vbMinX) / viewBox.width) * 100;
  const topPct = ((-comp.position.y - size / 2 - vbMinY) / viewBox.height) * 100;
  const widthPct = (size / viewBox.width) * 100;
  const heightPct = (size / viewBox.height) * 100;

  return [
    clampPct(leftPct),
    clampPct(topPct),
    Math.min(100 - clampPct(leftPct), widthPct),
    Math.min(100 - clampPct(topPct), heightPct),
  ];
}

/** Clamp a percentage value to [0, 99] */
function clampPct(v: number): number {
  return Math.max(0, Math.min(99, v));
}

function buildRelationships(
  components: Record<string, ComponentDef>,
  dwgComponents: DwgComponent[]
) {
  // Build spatial relationships: components on the same centerline are related
  const centerlines = dwgComponents.filter(
    (c) => categorizeBlock(c.blockName) === "centerline"
  );
  const nozzles = dwgComponents.filter(
    (c) => categorizeBlock(c.blockName) === "nozzle"
  );

  for (const cl of centerlines) {
    const clComp = components[cl.id];
    if (!clComp) continue;

    // Find nozzles near this centerline (within scale distance)
    const threshold = cl.scale.x * 5;
    const nearbyNozzles = nozzles.filter((n) => {
      const dx = Math.abs(n.position.x - cl.position.x);
      const dy = Math.abs(n.position.y - cl.position.y);
      return Math.sqrt(dx * dx + dy * dy) < threshold;
    });

    for (const nozzle of nearbyNozzles) {
      const nComp = components[nozzle.id];
      if (!nComp) continue;

      if (!clComp.downstream.includes(nozzle.id)) {
        clComp.downstream.push(nozzle.id);
      }
      if (!nComp.upstream.includes(cl.id)) {
        nComp.upstream.push(cl.id);
      }
    }
  }
}

/**
 * Correlate components across two sheets of the same drawing.
 *
 * Components match when they share the same block name (same physical part)
 * or, for nozzles, the same nozzle ID (N1, N3, etc.). Each match group gets
 * a shared correlationId so the UI and AI can link them.
 */
export function correlateSheets(
  sheetsComponents: DwgComponent[][]
): Record<string, string>[] {
  if (sheetsComponents.length < 2) {
    return sheetsComponents.map(() => ({}));
  }

  const correlationMaps: Record<string, string>[] = sheetsComponents.map(() => ({}));
  let correlationCounter = 0;

  // Index sheet 0 components by block name + nozzle ID
  const sheet0ByBlock = new Map<string, DwgComponent[]>();
  const sheet0ByNozzle = new Map<string, DwgComponent>();

  for (const comp of sheetsComponents[0]) {
    const key = comp.blockName;
    if (!sheet0ByBlock.has(key)) sheet0ByBlock.set(key, []);
    sheet0ByBlock.get(key)!.push(comp);

    if (comp.nozzleId) {
      sheet0ByNozzle.set(comp.nozzleId, comp);
    }
  }

  // Match sheet 1+ components against sheet 0
  for (let si = 1; si < sheetsComponents.length; si++) {
    for (const comp of sheetsComponents[si]) {
      let match: DwgComponent | undefined;

      // Priority 1: nozzle ID match (strongest signal)
      if (comp.nozzleId && sheet0ByNozzle.has(comp.nozzleId)) {
        match = sheet0ByNozzle.get(comp.nozzleId);
      }

      // Priority 2: block name + label match
      if (!match) {
        const candidates = sheet0ByBlock.get(comp.blockName);
        if (candidates?.length === 1) {
          match = candidates[0];
        } else if (candidates) {
          // Multiple candidates — match by label
          match = candidates.find((c) => c.label === comp.label);
        }
      }

      if (match) {
        // Check if match already has a correlation ID
        const existingId = correlationMaps[0][match.id];
        const corrId = existingId ?? `corr-${correlationCounter++}`;

        if (!existingId) {
          correlationMaps[0][match.id] = corrId;
        }
        correlationMaps[si][comp.id] = corrId;
      }
    }
  }

  return correlationMaps;
}

/** Detect what kind of view a sheet represents based on its component layout */
export function detectSheetView(components: DwgComponent[]): string {
  if (components.length === 0) return "Unknown View";

  // Analyze the spatial distribution of components
  const xs = components.map((c) => c.position.x);
  const ys = components.map((c) => c.position.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  const aspect = xRange / (yRange || 1);

  // Elevation views tend to be taller than wide (aspect < 2)
  // Plan views tend to be wider than tall (aspect > 2)
  // Section views are typically similar to elevation
  if (aspect > 3) return "Plan View";
  if (aspect < 0.5) return "Section View";
  return "Elevation View";
}

/** Parse SVG viewBox to get dimensions */
export function parseSvgViewBox(svg: string): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const match = svg.match(
    /viewBox="([0-9eE.+-]+)\s+([0-9eE.+-]+)\s+([0-9eE.+-]+)\s+([0-9eE.+-]+)"/
  );
  if (!match) {
    return { minX: 0, minY: 0, width: 1600, height: 900 };
  }
  return {
    minX: parseFloat(match[1]),
    minY: parseFloat(match[2]),
    width: parseFloat(match[3]),
    height: parseFloat(match[4]),
  };
}
