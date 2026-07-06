import { fastPosition } from "./svg-stretch";
import { isAnnotationElement } from "./annotations";

export interface ViewRegion {
  xMin: number;
  xMax: number;
}

/** A gutter must exceed this multiple of the median inter-sample X-gap to split views. */
const GUTTER_FACTOR = 20;
/** ...and be at least this many drawing units wide (units are inches; 1 unit = 1 inch). */
const MIN_GUTTER_UNITS = 100;

/**
 * Partition Model_Space into side-by-side view regions by detecting the large X-gutter
 * between elevations. Uses ONLY equipment X-positions (annotations excluded, so their
 * scattered placement does not blur the split). Returns [] when there is too little
 * geometry to cluster, and a single region when there is no clear gutter — both cases
 * make the caller fall back to today's global behavior.
 */
export function computeViewRegions(modelSpace: Element): ViewRegion[] {
  const xs: number[] = [];
  for (const child of Array.from(modelSpace.children)) {
    if (isAnnotationElement(child)) continue;
    const p = fastPosition(child);
    if (p && Number.isFinite(p.x)) xs.push(p.x);
  }
  if (xs.length < 2) return [];
  xs.sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;
  const threshold = Math.max(MIN_GUTTER_UNITS, median * GUTTER_FACTOR);

  const regions: ViewRegion[] = [];
  let start = xs[0];
  let prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - prev > threshold) {
      regions.push({ xMin: start, xMax: prev });
      start = xs[i];
    }
    prev = xs[i];
  }
  regions.push({ xMin: start, xMax: prev });
  return regions;
}

/**
 * Map an X position to its view region. If X lands inside a region, return it; if it
 * falls in a gutter, return the nearest region (ties resolve to the LEFT region for
 * determinism). Returns null when there are no regions, so the caller uses global scope.
 */
export function viewOf(x: number, regions: ViewRegion[]): ViewRegion | null {
  if (regions.length === 0) return null;
  for (const r of regions) if (x >= r.xMin && x <= r.xMax) return r;
  let best = regions[0];
  let bestDist = Infinity;
  for (const r of regions) {
    const dist = x < r.xMin ? r.xMin - x : x - r.xMax;
    if (dist < bestDist) {
      bestDist = dist; // strict '<' keeps the left-most region on ties (regions are x-sorted)
      best = r;
    }
  }
  return best;
}
