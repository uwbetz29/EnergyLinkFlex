/**
 * Dimensions table — the "as-configured" spec for the bid package: each
 * component's governing Height/Width. Pure; pairs with the change ledger
 * (what changed) to form the one-click bid document.
 */

import { dimKeyToDirection } from "./svg-stretch";

export interface DimTableRow {
  componentId: string;
  name: string;
  type: string;
  height: string | null;
  width: string | null;
}

type ComponentLike = { name: string; type: string; dims: Record<string, string> };

/** First dim value whose key maps to the given direction, else null. */
function firstDim(
  dims: Record<string, string>,
  dir: "vertical" | "horizontal"
): string | null {
  for (const [key, value] of Object.entries(dims)) {
    if (dimKeyToDirection(key) === dir) return value;
  }
  return null;
}

export function buildDimensionsTable(
  components: Record<string, ComponentLike>
): DimTableRow[] {
  const rows: DimTableRow[] = [];
  for (const [componentId, comp] of Object.entries(components)) {
    const height = firstDim(comp.dims, "vertical");
    const width = firstDim(comp.dims, "horizontal");
    if (height === null && width === null) continue; // no governing dimension
    rows.push({ componentId, name: comp.name, type: comp.type, height, width });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
