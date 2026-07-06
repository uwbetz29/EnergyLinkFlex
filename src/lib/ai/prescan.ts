/**
 * AI Pre-Scan — identifies major system sections from parsed DWG data.
 *
 * Called server-side during DWG upload, after parseDwg() + extractComponents().
 * Sends structured data (dimensions, components, metadata) to Claude,
 * which returns named sections with dimension mappings that the stretch
 * engine can use directly.
 *
 * This replaces the old approach of extracting DWG INSERT blocks (which
 * gave us nozzles and centerlines instead of duct sections).
 */

import { generateText } from "ai";
import { SCR_SYSTEM_KNOWLEDGE, THINKING_MODEL } from "./scr-knowledge";
import type {
  DwgComponent,
  DwgDimension,
  DwgTitleBlock,
  DwgEntitySummary,
} from "@/lib/dwg/types";

/* ─── Types ─── */

export interface AiSection {
  name: string;
  type: string;
  /** Bounding box as % of viewBox: [left, top, width, height] */
  box: [number, number, number, number];
  /** Editable dimensions: { "Height": "15'-0 1/8\"" } */
  dims: Record<string, string>;
  /** SVG dimension block IDs: { "Height": "*D23" } */
  dimBlocks: Record<string, string>;
  /** Which dim key is the main one for quick-adjust */
  mainDim: string;
  /** Gas-flow upstream section names */
  upstream: string[];
  /** Gas-flow downstream section names */
  downstream: string[];
  notes: string;
  icon: string;
  color: string;
}

export interface PreScanResult {
  sections: AiSection[];
  /** AI's confidence in the overall identification (0 to 1) */
  confidence: number;
  /** Summary of what the AI found */
  summary: string;
}

export interface PreScanInput {
  dimensions: DwgDimension[];
  components: DwgComponent[];
  titleBlock: DwgTitleBlock;
  entitySummary: DwgEntitySummary;
  viewBox: { minX: number; minY: number; width: number; height: number };
  /** SVG dimension block metadata extracted from the SVG string */
  dimBlockInfo: DimBlockInfo[];
}

/** Lightweight info about a *D## dimension block extracted from SVG */
export interface DimBlockInfo {
  blockId: string;
  /** Formatted dimension value text (e.g., "15'-0 1/8\"") */
  text: string;
  /** Embedded section label from the block's 2nd <text> (e.g., "SILENCER"), if any */
  label: string | null;
  /** Parsed measurement in inches (1 SVG unit = 1 inch), or null if unparseable */
  valueInches: number | null;
  /** Text-anchor position in Model_Space coords (the measurement center) */
  position: { x: number; y: number };
  /** Stretch zone = the measured range along the axis (text-center ± value/2) */
  zone: { min: number; max: number };
  /** "Height" or "Width" from the block's bounding-box aspect */
  direction: "Height" | "Width";
  /** true when real witness-line endpoints sit at both zone ends */
  witnessConfirmed: boolean;
}

/* ─── Color palette for AI-identified sections ─── */

const SECTION_COLORS = [
  "#2563eb", // blue — primary duct
  "#7c3aed", // violet
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#c026d3", // fuchsia
  "#ea580c", // orange
  "#0d9488", // teal
];

const TYPE_ICONS: Record<string, string> = {
  duct: "D",
  equipment: "E",
  structure: "S",
  internal: "I",
  access: "A",
  nozzle: "N",
  flow: "F",
  default: "C",
};

/* ─── SVG Dimension Block Extraction ─── */

/** Matches a feet-inch dimension value, optional diameter (U+00D8) or ~ prefix. */
const DIM_TEXT_RE = /^[Ø~]?\d+['‘′]\s*-?\s*\d+(?:\s+\d+\/\d+)?["”″]?$/;

/** Parse a feet-inch string ("8'-0\"", diameter 9'-0", "15'-0 1/8\"") to inches. */
function parseInches(s: string): number | null {
  const c = s.replace(/^[Ø~]/, "").trim();
  const m = c.match(/(\d+)['‘′][- ]?(\d+)?(?:\s+(\d+)\/(\d+))?/);
  if (m) {
    const ft = +m[1], inch = +(m[2] || 0), n = +(m[3] || 0), d = +(m[4] || 1);
    return ft * 12 + inch + (d ? n / d : 0);
  }
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

/**
 * Return the index just past the balanced </g> that closes the <g> opening at
 * `open`. LibreDWG nests <g> children (witness lines + text sub-groups) inside
 * each *D## block, so a non-greedy `[\s\S]*?</g>` regex stops at the FIRST nested
 * </g> -- the bug that made the old extractor return 0 dimensions. This counts depth.
 */
function balancedGroupEnd(s: string, open: number): number {
  let i = open + 2, depth = 1;
  while (i < s.length && depth > 0) {
    const o = s.indexOf("<g", i);
    const c = s.indexOf("</g>", i);
    if (c === -1) break;
    if (o !== -1 && o < c) { depth++; i = o + 2; }
    else { depth--; i = c + 4; }
  }
  return i;
}

/**
 * Extract dimension block metadata from the SVG string using balanced-tag
 * matching (no DOM -- runs server-side). Per *D## block it captures:
 *  - text        : the feet-inch value (e.g. "8'-0\"")
 *  - label       : the section name the drawing embedded (2nd <text>, e.g. "SILENCER")
 *  - valueInches : parsed numeric inches (1 SVG unit = 1 inch)
 *  - direction   : Height / Width from the bounding-box aspect
 *  - zone        : the exact measured range along the axis (text-center +/- value/2),
 *                  which matches the witness lines (proven in the offline lab)
 * Coords are Model_Space (Y-up, 1 unit = 1 inch); the block's line coords are
 * already absolute, so no <use>-offset correction is needed.
 */
export function extractDimBlocksFromSvg(svg: string): DimBlockInfo[] {
  const results: DimBlockInfo[] = [];
  const idRe = /<g\s+id="(\*D\d+)"[^>]*>/g;
  let m: RegExpExecArray | null;

  while ((m = idRe.exec(svg)) !== null) {
    const blockId = m[1];
    const content = svg.slice(m.index, balancedGroupEnd(svg, m.index));

    // Text children (strip any nested markup), split into value vs. label.
    const texts = [...content.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
      .map((t) => t[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    const text = texts.find((t) => DIM_TEXT_RE.test(t)) || "";
    const label = texts.find((t) => !DIM_TEXT_RE.test(t)) || null;
    if (!text) continue;

    // The value text is anchored at the measurement center (text-anchor:middle).
    const tp = content.match(/<text[^>]*\bx="([^"]*)"[^>]*\by="([^"]*)"/);
    const position = tp
      ? { x: +(+tp[1]).toFixed(1), y: +(+tp[2]).toFixed(1) }
      : { x: 0, y: 0 };

    const lines = [...content.matchAll(
      /<line[^>]*x1="([^"]*)"[^>]*y1="([^"]*)"[^>]*x2="([^"]*)"[^>]*y2="([^"]*)"/g
    )].map((l) => ({ x1: +l[1], y1: +l[2], x2: +l[3], y2: +l[4] }));
    if (!lines.length) continue;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const l of lines) {
      minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
      minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
    }
    const direction: "Height" | "Width" =
      (maxX - minX) >= (maxY - minY) ? "Width" : "Height";
    const valueInches = parseInches(text);

    // Zone = the measured range. Text is anchored at the measurement center, so
    // zone = center +/- value/2 (matches the witness lines exactly; the dim line
    // itself is drawn inset). Fall back to the raw bbox extent when unparseable.
    const half = valueInches != null ? valueInches / 2 : 0;
    const center = direction === "Width" ? position.x : position.y;
    const zone = valueInches != null
      ? { min: +(center - half).toFixed(1), max: +(center + half).toFixed(1) }
      : direction === "Width"
        ? { min: minX, max: maxX }
        : { min: minY, max: maxY };

    // Confidence: a real witness-line endpoint sits at each zone end.
    const near = (v: number) => lines.some((l) =>
      direction === "Width"
        ? Math.abs(l.x1 - v) < 3 || Math.abs(l.x2 - v) < 3
        : Math.abs(l.y1 - v) < 3 || Math.abs(l.y2 - v) < 3);

    results.push({
      blockId,
      text,
      label,
      valueInches,
      position,
      zone,
      direction,
      witnessConfirmed: near(zone.min) && near(zone.max),
    });
  }

  return results;
}

/* ─── AI Pre-Scan ─── */

export async function performPreScan(input: PreScanInput): Promise<PreScanResult> {
  const { dimensions, components, titleBlock, entitySummary, viewBox, dimBlockInfo } = input;

  // Build context strings
  const dimSummary = dimBlockInfo
    .map((d) => {
      const inches = d.valueInches != null ? ` = ${d.valueInches}in` : "";
      const lbl = d.label ? ` label="${d.label}"` : "";
      const approx = d.witnessConfirmed ? "" : " (zone approx)";
      return `  ${d.blockId}: "${d.text}"${inches} (${d.direction}) zone=[${d.zone.min.toFixed(1)}, ${d.zone.max.toFixed(1)}]${lbl}${approx}`;
    })
    .join("\n");

  // Native DIMENSION entities: authoritative measured values (inches). Their text
  // is a "<>" placeholder (no embedded label) and they carry no usable position,
  // so they act as a completeness/accuracy cross-check for the SVG blocks above.
  const nativeInches = dimensions
    .map((d) => d.measurement)
    .filter((n) => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  const svgInches = dimBlockInfo
    .map((d) => d.valueInches)
    .filter((n): n is number => n != null);
  const matchedNative = nativeInches.filter((n) =>
    svgInches.some((s) => Math.abs(s - n) < 0.6)
  ).length;
  const nativeDimSummary = nativeInches.length
    ? `${dimensions.length} entities; values (in): ${nativeInches.map((n) => +n.toFixed(2)).join(", ")}\n` +
      `  (${matchedNative}/${nativeInches.length} match a labeled block above; DIMENSION positions are unavailable)`
    : "None.";

  const compSummary = components
    .slice(0, 40)
    .map((c) => `  ${c.label} (${c.blockName}) at (${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}) layer="${c.layer}" attribs={${Object.entries(c.attribs).map(([k,v]) => `${k}:${v}`).join(", ")}}`)
    .join("\n");

  const drawingInfo = `Drawing: ${titleBlock.title ?? "untitled"} #${titleBlock.drawingNumber ?? "?"} for ${titleBlock.customer ?? "unknown customer"}`;
  const entityInfo = `Entities: ${entitySummary.totalEntities} total (${Object.entries(entitySummary.typeCounts).map(([t,n]) => `${t}:${n}`).join(", ")})`;
  const vbInfo = `ViewBox: minX=${viewBox.minX.toFixed(1)} minY=${viewBox.minY.toFixed(1)} width=${viewBox.width.toFixed(1)} height=${viewBox.height.toFixed(1)}`;

  const systemPrompt = `You are the AI pre-scan engine for EnergyLink FLEX — an intelligent sales configurator for SCR/CO catalyst systems.

${SCR_SYSTEM_KNOWLEDGE}

## Your Task

You are analyzing a parsed DWG engineering drawing at upload time. Your job is to identify the MAJOR SYSTEM SECTIONS — the duct regions, equipment, and structures that a sales engineer would want to resize in "what if" scenarios.

These are NOT individual nozzles or centerlines. These are the BIG sections visible in the elevation view:
- **Ducts**: SCR Duct, D.I. Duct, T.A. Duct, Dist. Grid Duct (tall rectangular sections)
- **Equipment**: Silencer, Stack (cylinder/rectangle at top), Turbine (bottom)
- **Internals**: Catalyst Frame, Distribution Grid, Inside Liner
- **Access**: Platforms, Ladders, Grating

## Drawing Data

${drawingInfo}
${entityInfo}
${vbInfo}

### Labeled Dimension Blocks (from the SVG: geometry + the drawing's own labels)
Format: blockId: "value" = inches (direction) zone=[min, max] label="...". A zone is
the exact measured range along the axis in Model_Space units (1 unit = 1 inch).
"zone approx" means the witness lines did not confirm both ends; trust it a little less.
${dimSummary || "No dimension blocks found."}

### Native Dimensions (authoritative measured values from DWG DIMENSION entities)
${nativeDimSummary}

### Extracted Components (DWG block inserts: internal parts with positions)
${compSummary || "No components found."}

## Coordinate System
- 1 SVG unit = 1 inch. Zones/positions above are Model_Space (Y-up); the ground is ~y 291.5.
- Several blocks embed the section's own label (e.g. SILENCER=8'-0", 4000 STACK=50'-0",
  INSIDE LINER=Ø9'-0", GAS PATH, GRATING). Treat those as fixed anchors; do NOT rename them.
- Infer the remaining sections from the component inserts' names/positions + gas-flow order.

## How to Compute Bounding Boxes (box = [left%, top%, width%, height%] of the viewBox)
X maps directly to the viewBox; Y is flipped (viewBox Y = -Model_Space Y). So for a zone:
- Height section: top% = (-zone.max - viewBox.minY) / viewBox.height * 100,
  height% = (zone.max - zone.min) / viewBox.height * 100
- Width section: left% = (zone.min - viewBox.minX) / viewBox.width * 100,
  width% = (zone.max - zone.min) / viewBox.width * 100
Union the zones of a section's dimensions for its full box; widen slightly for the footprint.

## Response Format

Respond ONLY with a JSON object:
{
  "sections": [
    {
      "name": "SCR Duct",
      "type": "duct",
      "box": [15.0, 30.0, 25.0, 40.0],
      "dims": {"Height": "15'-0 1/8\\"", "Width": "9'-0\\""},
      "dimBlocks": {"Height": "*D23", "Width": "*D16"},
      "mainDim": "Height",
      "upstream": ["Dist. Grid Duct"],
      "downstream": ["Silencer"],
      "notes": "Main SCR catalyst housing"
    }
  ],
  "confidence": 0.85,
  "summary": "Identified 6 major sections in the Titan PGM130 elevation view"
}

## Rules
- Identify 4-10 major sections (individual nozzles are connection points ON sections, not sections)
- When a dimension block has a label, name that section from the label and keep its exact block ID
- Use EXACT dimension text values from the dimension blocks (e.g., "15'-0 1/8\\"")
- Use EXACT block IDs from the *D## blocks for dimBlocks mapping
- Prefer witness-confirmed blocks; a "zone approx" block may still be used but is lower-confidence
- mainDim should be "Height" for vertical sections (ducts), "Width" for horizontal
- upstream/downstream follow gas flow: Turbine to Stack
- Bounding boxes should roughly enclose the section's visual footprint
- If you can't identify a section confidently, skip it (fewer accurate > more guesses)
- Each dimension block should belong to AT MOST one section`;

  try {
    const result = await generateText({
      model: THINKING_MODEL as any,
      system: systemPrompt,
      prompt: "Analyze this engineering drawing and identify the major system sections with their dimensions and stretch zones.",
    });

    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[ELF prescan] AI returned non-JSON:", text.slice(0, 200));
      return buildFallback(dimBlockInfo, viewBox);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const sections: AiSection[] = (parsed.sections || []).map((s: any, i: number) => ({
      name: s.name || `Section ${i + 1}`,
      type: s.type || "default",
      box: s.box || [0, 0, 100, 100],
      dims: s.dims || {},
      dimBlocks: s.dimBlocks || {},
      mainDim: s.mainDim || Object.keys(s.dims || {})[0] || "",
      upstream: s.upstream || [],
      downstream: s.downstream || [],
      notes: s.notes || "",
      icon: TYPE_ICONS[s.type] || TYPE_ICONS.default,
      color: SECTION_COLORS[i % SECTION_COLORS.length],
    }));

    console.log(`[ELF prescan] AI identified ${sections.length} sections: ${sections.map(s => s.name).join(", ")}`);

    return {
      sections,
      confidence: parsed.confidence ?? 0.5,
      summary: parsed.summary ?? `Identified ${sections.length} sections`,
    };
  } catch (error) {
    console.error("[ELF prescan] AI error:", error);
    return buildFallback(dimBlockInfo, viewBox);
  }
}

/* ─── Fallback ─── */

function buildFallback(
  dimBlockInfo: DimBlockInfo[],
  viewBox: { minX: number; minY: number; width: number; height: number }
): PreScanResult {
  // Group nearby dimension blocks into crude sections
  const sections: AiSection[] = [];
  const used = new Set<string>();

  for (const dim of dimBlockInfo) {
    if (used.has(dim.blockId)) continue;
    used.add(dim.blockId);

    const dims: Record<string, string> = { [dim.direction]: dim.text };
    const dimBlocks: Record<string, string> = { [dim.direction]: dim.blockId };

    // Compute rough bounding box
    const cx = dim.position.x;
    const cy = dim.position.y;
    const pad = 50; // SVG units padding
    const left = ((cx - pad - viewBox.minX) / viewBox.width) * 100;
    const top = ((cy - pad - viewBox.minY) / viewBox.height) * 100;
    const width = (pad * 2 / viewBox.width) * 100;
    const height = (pad * 2 / viewBox.height) * 100;

    sections.push({
      name: `Section (${dim.text})`,
      type: "default",
      box: [
        Math.max(0, left),
        Math.max(0, top),
        Math.min(width, 100 - left),
        Math.min(height, 100 - top),
      ],
      dims,
      dimBlocks,
      mainDim: dim.direction,
      upstream: [],
      downstream: [],
      notes: `Dimension block ${dim.blockId}`,
      icon: "C",
      color: SECTION_COLORS[sections.length % SECTION_COLORS.length],
    });
  }

  return {
    sections,
    confidence: 0.1,
    summary: `Fallback: created ${sections.length} sections from dimension blocks`,
  };
}
