/**
 * Server-side DWG parser using LibreDWG WASM.
 *
 * Reads a DWG binary buffer and returns structured data:
 * blocks, inserts, layers, dimensions, title block metadata, and SVG rendering.
 */

import { Dwg_File_Type, LibreDwg } from "@mlightcad/libredwg-web";
import type { DwgDatabase } from "@mlightcad/libredwg-web";
import { hardenLibreDwg } from "./harden";
import type {
  DwgAttrib,
  DwgBlockDef,
  DwgDimension,
  DwgInsert,
  DwgLayer,
  DwgParseResult,
  DwgEntitySummary,
  DwgTitleBlock,
} from "./types";

let cachedLib: Awaited<ReturnType<typeof LibreDwg.create>> | null = null;

async function getLib(wasmDir: string) {
  if (!cachedLib) {
    cachedLib = await LibreDwg.create(wasmDir);
    // Guard the MTEXT-column OOB crash that aborts parses on some DWGs.
    hardenLibreDwg(cachedLib);
  }
  return cachedLib;
}

/** Parse a DWG file buffer into structured data */
export async function parseDwg(
  buffer: ArrayBuffer,
  wasmDir: string
): Promise<DwgParseResult> {
  const lib = await getLib(wasmDir);

  const dataPtr = lib.dwg_read_data(buffer, Dwg_File_Type.DWG);
  if (dataPtr === undefined) {
    throw new Error("Failed to parse DWG file — invalid or corrupted");
  }

  const db = lib.convert(dataPtr);
  lib.dwg_free(dataPtr);

  const layers = extractLayers(db);
  const blocks = extractBlocks(db);
  const inserts = extractInserts(db);
  const dimensions = extractDimensions(db);
  const titleBlock = extractTitleBlock(inserts);
  const entitySummary = extractEntitySummary(db);

  let svg: string;
  try {
    svg = lib.dwg_to_svg(db);
  } catch {
    svg = "";
  }

  return {
    layers,
    blocks,
    inserts,
    components: [], // populated by component extractor
    dimensions,
    titleBlock,
    entitySummary,
    svg,
  };
}

function extractLayers(db: DwgDatabase): DwgLayer[] {
  return db.tables.LAYER.entries.map((layer: any) => ({
    name: layer.name,
    handle: layer.handle ?? "",
    colorIndex: layer.colorIndex ?? 7,
    color: layer.color != null ? `#${(layer.color & 0xffffff).toString(16).padStart(6, "0")}` : null,
    isFrozen: layer.isFrozen ?? false,
    isOff: layer.isOff ?? false,
    isLocked: layer.isLocked ?? false,
  }));
}

function extractBlocks(db: DwgDatabase): DwgBlockDef[] {
  return db.tables.BLOCK_RECORD.entries
    .filter(
      (b: any) =>
        b.name !== "*Model_Space" &&
        b.name !== "*Paper_Space" &&
        !b.name.startsWith("*")
    )
    .map((block: any) => {
      const typeCounts: Record<string, number> = {};
      (block.entities || []).forEach((e: any) => {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
      });

      return {
        name: block.name,
        handle: block.handle ?? "",
        basePoint: block.basePoint ?? { x: 0, y: 0, z: 0 },
        description: block.description ?? "",
        entityCount: block.entities?.length ?? 0,
        entityTypes: typeCounts,
        flags: block.flags ?? 0,
      };
    });
}

function extractInserts(db: DwgDatabase): DwgInsert[] {
  const allEntities = getAllEntities(db);

  return allEntities
    .filter((e: any) => e.type === "INSERT")
    .map((ins: any) => ({
      handle: ins.handle ?? "",
      blockName: ins.name ?? "",
      insertionPoint: ins.insertionPoint ?? { x: 0, y: 0, z: 0 },
      xScale: ins.xScale ?? 1,
      yScale: ins.yScale ?? 1,
      zScale: ins.zScale ?? 1,
      rotation: ins.rotation ?? 0,
      layer: ins.layer ?? "0",
      attribs: (ins.attribs || []).map(
        (a: any): DwgAttrib => ({
          tag: a.tag ?? "",
          text: a.text?.text ?? a.tag ?? "",
          position: a.text?.startPoint ?? a.alignmentPoint ?? { x: 0, y: 0, z: 0 },
          textHeight: a.text?.textHeight ?? 0,
          rotation: a.text?.rotation ?? 0,
          layer: a.layer ?? "0",
        })
      ),
    }));
}

function extractDimensions(db: DwgDatabase): DwgDimension[] {
  const allEntities = getAllEntities(db);

  return allEntities
    .filter((e: any) => e.type === "DIMENSION")
    .map((dim: any) => ({
      handle: dim.handle ?? "",
      layer: dim.layer ?? "0",
      type: dim.dimensionType ?? "unknown",
      measurement: dim.measurement ?? 0,
      text: dim.text ?? "",
      defPoint: dim.defPoint ?? { x: 0, y: 0, z: 0 },
      midPoint: dim.midPoint ?? { x: 0, y: 0, z: 0 },
    }));
}

function extractTitleBlock(inserts: DwgInsert[]): DwgTitleBlock {
  // Title block data lives in INSERTs of blocks containing "Title" in name
  const titleInsert = inserts.find(
    (ins) =>
      ins.blockName.toLowerCase().includes("title") &&
      ins.attribs.length > 0
  );

  if (!titleInsert) {
    return {
      drawingNumber: null,
      title: null,
      subtitle: null,
      customer: null,
      company: null,
      drawnBy: null,
      checkedBy: null,
      date: null,
      revision: null,
      scale: null,
    };
  }

  const attribs = titleInsert.attribs;

  // Heuristic matching: title blocks vary by template, but common patterns exist
  // Match by position and content patterns
  const findAttrib = (patterns: RegExp[]) => {
    for (const a of attribs) {
      for (const p of patterns) {
        if (p.test(a.tag)) return a.tag;
      }
    }
    return null;
  };

  // For ELC drawings, attrib tags ARE the values (tag = value in this template)
  // Drawing number: matches pattern like "24081-CS1-0001"
  const drawingNumber =
    findAttrib([/^\d{4,5}-[A-Z]{2,3}\d?-\d{3,4}$/]) ?? null;

  // Title: longest text attrib that isn't a date/initials/number
  const titleCandidates = attribs
    .filter(
      (a) =>
        a.tag.length > 10 &&
        !/^\d/.test(a.tag) &&
        !/^[A-Z]{1,3}$/.test(a.tag)
    )
    .sort((a, b) => b.tag.length - a.tag.length);

  const title = titleCandidates[0]?.tag ?? null;
  const subtitle = titleCandidates[1]?.tag ?? null;
  const customer = titleCandidates[2]?.tag ?? null;
  const company = titleCandidates[3]?.tag ?? null;

  // Date: matches MM/DD/YYYY pattern
  const dateAttrib = attribs.find((a) =>
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(a.tag)
  );

  // Initials: short 2-3 char uppercase
  const initials = attribs
    .filter((a) => /^[A-Z]{2,3}$/.test(a.tag))
    .map((a) => a.tag);

  // Revision number
  const revAttrib = attribs.find((a) => /^[0-9A-Z]$/.test(a.tag));

  return {
    drawingNumber,
    title,
    subtitle,
    customer,
    company,
    drawnBy: initials[0] ?? null,
    checkedBy: initials[1] ?? null,
    date: dateAttrib?.tag ?? null,
    revision: revAttrib?.tag ?? null,
    scale: null,
  };
}

function extractEntitySummary(db: DwgDatabase): DwgEntitySummary {
  const allEntities = getAllEntities(db);
  const typeCounts: Record<string, number> = {};

  allEntities.forEach((e: any) => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });

  return {
    totalEntities: allEntities.length,
    typeCounts,
  };
}

/** Get all entities from model space + paper space */
function getAllEntities(db: DwgDatabase): any[] {
  const modelSpace = db.entities || [];

  // Also include paper space entities
  const paperSpace = db.tables.BLOCK_RECORD.entries.find(
    (b: any) => b.name === "*Paper_Space"
  );
  const paperEntities = paperSpace?.entities || [];

  return [...modelSpace, ...paperEntities];
}
