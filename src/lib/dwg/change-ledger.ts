/**
 * Change ledger — the deterministic "what changed on this bid" record.
 *
 * Aggregates every edited dimension (old → new, delta, % change) across all
 * components from the editor's `originals` snapshot vs the current `components`.
 * Pure and side-effect free so it can drive both the on-screen ledger panel and
 * (later) the exported bid package. Non-dimensional dims (X Position, Rotation)
 * are skipped — only feet-inches values that actually parse are reported.
 */

import { parseDimInches, dimKeyToDirection } from "./svg-stretch";

export interface LedgerRow {
  componentId: string;
  componentName: string;
  dimKey: string;
  direction: "vertical" | "horizontal";
  oldValue: string;
  newValue: string;
  /** newInches - oldInches (positive = grew). */
  deltaInches: number;
  /** Percent change relative to the original (0 when the original was 0). */
  pctChange: number;
}

type ComponentLike = { name: string; dims: Record<string, string> };

export function buildChangeLedger(
  originals: Record<string, Record<string, string>>,
  components: Record<string, ComponentLike>
): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const [componentId, dimOrigins] of Object.entries(originals)) {
    const comp = components[componentId];
    if (!comp) continue; // component removed / not built yet

    for (const [dimKey, oldValue] of Object.entries(dimOrigins)) {
      const newValue = comp.dims[dimKey];
      if (newValue === undefined || newValue === oldValue) continue;

      // Only real size dimensions (Height/Width/…) belong on a bid ledger;
      // X Position / Rotation map to no direction and are skipped.
      const direction = dimKeyToDirection(dimKey);
      if (direction === null) continue;

      const oldInches = parseDimInches(oldValue);
      const newInches = parseDimInches(newValue);
      if (oldInches === null || newInches === null) continue; // unparseable

      const deltaInches = newInches - oldInches;
      if (deltaInches === 0) continue; // same measurement, different text form

      rows.push({
        componentId,
        componentName: comp.name,
        dimKey,
        direction,
        oldValue,
        newValue,
        deltaInches,
        pctChange: oldInches === 0 ? 0 : (deltaInches / oldInches) * 100,
      });
    }
  }

  // Most significant changes first (the headline numbers for a bid).
  rows.sort((a, b) => Math.abs(b.deltaInches) - Math.abs(a.deltaInches));
  return rows;
}
