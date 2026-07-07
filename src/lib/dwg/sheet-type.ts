import type { DwgParseResult } from "./types";

/** A GA sheet is resizable only if it has real DIMENSION entities to drive the stretch. */
export const MIN_GA_DIMS = 1;

const SCHEMATIC_MARKERS = ["HATCH", "ACAD_TABLE", "VIEWPORT"] as const;

export type SheetType = "GA" | "PID";

/** Deterministic sheet-type classification from data the parser already produces. */
export function classifySheetType(
  parseResult: Pick<DwgParseResult, "dimensions" | "entitySummary">
): SheetType {
  return (parseResult.dimensions?.length ?? 0) >= MIN_GA_DIMS ? "GA" : "PID";
}

/** Badge copy for a non-resizable sheet; "" for GA (no badge). */
export function sheetTypeLabel(
  parseResult: Pick<DwgParseResult, "dimensions" | "entitySummary">
): string {
  if (classifySheetType(parseResult) === "GA") return "";
  const counts = parseResult.entitySummary?.typeCounts ?? {};
  const schematic = SCHEMATIC_MARKERS.some((m) => (counts[m] ?? 0) > 0);
  return schematic ? "P&ID — not resizable" : "Not resizable — no dimensions";
}
