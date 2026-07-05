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
import { SCR_SYSTEM_KNOWLEDGE } from "./scr-knowledge";
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
  /** AI's confidence in the overall identification (0-1) */
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
  /** Formatted dimension text (e.g., "15'-0 1/8\"") */
  text: string;
  /** Position of the <use> element in viewBox coordinates */
  position: { x: number; y: number };
  /** Extension line bounds */
  extensionBounds: { min: number; max: number };
  /** "Height" or "Width" based on extension line orientation */
  direction: "Height" | "Width";
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

/**
 * Extract dimension block metadata from the SVG string.
 * Parses *D## block definitions to find dimension text, positions,
 * and extension line bounds — WITHOUT creating a DOM (runs server-side).
 */
export function extractDimBlocksFromSvg(svg: string): DimBlockInfo[] {
  const results: DimBlockInfo[] = [];

  // Match dimension text pattern: 15'-0 1/8", 9'-8 3/4", etc.
  const dimTextRe = /^[\u00d8~]?(\d+)['\u2018\u2032]\s*-?\s*(\d+)(?:\s+(\d+\/\d+))?["\u201d\u2033]?$/;

  // Find all <use> elements referencing *D## blocks
  const useRe = /<use[^>]*href="#(\*D\d+)"[^>]*(?:x="([^"]*)")?[^>]*(?:y="([^"]*)")?[^>]*\/?>/g;
  let useMatch;
  const usePositions = new Map<string, { x: number; y: number }>();

  while ((useMatch = useRe.exec(svg)) !== null) {
    const blockId = useMatch[1];
    const x = parseFloat(useMatch[2] || "0");
    const y = parseFloat(useMatch[3] || "0");
    if (!isNaN(x) && !isNaN(y)) {
      usePositions.set(blockId, { x, y });
    }
  }

  // Find all *D## block definitions in <defs>
  // LibreDWG outputs: <g id="*D16"> ... <text>15'-0 1/8"</text> ... <line .../> ... </g>
  const blockRe = /<g\s+id="(\*D\d+)"[^>]*>([\s\S]*?)<\/g>/g;
  let blockMatch;

  while ((blockMatch = blockRe.exec(svg)) !== null) {
    const blockId = blockMatch[1];
    const blockContent = blockMatch[2];

    // Find dimension text
    const textRe = /<text[^>]*>(.*?)<\/text>/g;
    let textMatch;
    let dimText = "";
    while ((textMatch = textRe.exec(blockContent)) !== null) {
      const content = textMatch[1].trim();
      if (dimTextRe.test(content)) {
        dimText = content;
        break;
      }
    }
    if (!dimText) continue;

    // Find extension lines and determine direction
    const lineRe = /<line[^>]*x1="([^"]*)"[^>]*y1="([^"]*)"[^>]*x2="([^"]*)"[^>]*y2="([^"]*)"[^>]*\/?>/g;
    let lineMatch;
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

    while ((lineMatch = lineRe.exec(blockContent)) !== null) {
      lines.push({
        x1: parseFloat(lineMatch[1]),
        y1: parseFloat(lineMatch[2]),
        x2: parseFloat(lineMatch[3]),
        y2: parseFloat(lineMatch[4]),
      });
    }

    if (lines.length === 0) continue;

    // Determine direction from the last line (the dimension line)
    const dimLine = lines[lines.length - 1];
    const dx = Math.abs(dimLine.x2 - dimLine.x1);
    const dy = Math.abs(dimLine.y2 - dimLine.y1);
    const direction: "Height" | "Width" = dy > dx ? "Height" : "Width";

    // Compute extension bounds (offset by <use> position)
    const usePos = usePositions.get(blockId);
    const offsetX = usePos?.x ?? 0;
    const offsetY = usePos?.y ?? 0;

    let min = Infinity;
    let max = -Infinity;
    for (const line of lines) {
      if (direction === "Height") {
        min = Math.min(min, line.y1 + offsetY, line.y2 + offsetY);
        max = Math.max(max, line.y1 + offsetY, line.y2 + offsetY);
      } else {
        min = Math.min(min, line.x1 + offsetX, line.x2 + offsetX);
        max = Math.max(max, line.x1 + offsetX, line.x2 + offsetX);
      }
    }

    if (!isFinite(min) || !isFinite(max)) continue;

    results.push({
      blockId,
      text: dimText,
      position: usePos ?? { x: 0, y: 0 },
      extensionBounds: { min, max },
      direction,
    });
  }

  return results;
}

/* ─── AI Pre-Scan ─── */

export async function performPreScan(input: PreScanInput): Promise<PreScanResult> {
  const { dimensions, components, titleBlock, entitySummary, viewBox, dimBlockInfo } = input;

  // Build context strings
  const dimSummary = dimBlockInfo
    .map((d) => `  ${d.blockId}: "${d.text}" (${d.direction}) at pos=(${d.position.x.toFixed(1)}, ${d.position.y.toFixed(1)}) ext=[${d.extensionBounds.min.toFixed(1)}, ${d.extensionBounds.max.toFixed(1)}]`)
    .join("\n");

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

### Dimension Blocks (SVG *D## blocks with measured values)
${dimSummary || "No dimension blocks found."}

### Extracted Components (DWG block inserts)
${compSummary || "No components found."}

## Coordinate System Notes
- The SVG uses a Y-flip matrix: internal Y = -viewBox Y
- viewBox minY is negative (top of drawing), minY + height ≈ 0 (bottom)
- Dimension positions are in Model_Space coords (Y-up)
- Extension bounds define the exact stretch zone for each dimension

## How to Compute Bounding Boxes
For each section, estimate a bounding box as percentages of the viewBox:
- left% = ((sectionLeft - viewBox.minX) / viewBox.width) * 100
- top% = ((sectionTop - viewBox.minY) / viewBox.height) * 100
- width% and height% similarly
Use the dimension block positions and extension bounds to estimate the section's spatial extent.
For dimensions spanning a section vertically, the extension bounds give you the Y range.
For dimensions spanning horizontally, they give the X range.

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
- Identify 4-10 major sections (not individual nozzles — those are connection points ON sections)
- Use EXACT dimension text values from the dimension blocks (e.g., "15'-0 1/8\\"")
- Use EXACT block IDs from the *D## blocks for dimBlocks mapping
- mainDim should be "Height" for vertical sections (ducts), "Width" for horizontal
- upstream/downstream follow gas flow: Turbine → ... → Stack
- Bounding boxes should roughly enclose the section's visual footprint
- If you can't identify a section confidently, skip it (fewer accurate > more guesses)
- Each dimension block should belong to AT MOST one section`;

  try {
    const result = await generateText({
      model: "anthropic/claude-sonnet-4.6" as any,
      system: systemPrompt,
      prompt: "Analyze this engineering drawing and identify the major system sections with their dimensions and stretch zones.",
      temperature: 0.2,
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
