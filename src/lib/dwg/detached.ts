/**
 * U3: detect detached sub-assemblies (skids / details) that a stretch should hold
 * RIGID rather than distort. Method = cross-axis GAP detection (a thin-bridge-tolerant
 * generalisation of the view-model's X-gutter): bin equipment positions per axis and
 * look for a near-EMPTY corridor that separates a compact peripheral cluster from the
 * main mass. Keying on emptiness (a few "pipe" elements crossing stay under the empty
 * threshold) succeeds where connectivity/erosion fail — validated offline on the real
 * 24081 Sheet_3 skid (~/dev/elf-lab/spike2-detect.mjs).
 *
 * Deterministic (no random/time). Operates on ORIGINAL Model_Space coords. A detached
 * body with confidence >= CONF_MIN can be held rigid; below it, the caller WARNs.
 */
import { fastPosition } from "./svg-stretch";
import { isAnnotationElement } from "./annotations";

const NUM_SLICES = 40;
/** A slice is "near-empty" if its count < EMPTY_FRAC × the densest slice. */
const EMPTY_FRAC = 0.15;
/** A corridor must span at least this fraction of the axis extent to qualify (rejects
 *  small inter-element gaps in sparse regions). */
const MIN_CORRIDOR_FRAC = 0.06;
/** Corridor width (as a fraction of extent) at which width-confidence saturates to 1. */
const CONFIDENT_FRAC = 0.2;
/** Each side of the corridor must hold at least this fraction of all points (both the
 *  main mass AND the detached cluster must be substantial — rejects tiny noise clusters
 *  AND, deliberately, a small-but-real detail like the Sheet_3 skid, which U2's band
 *  scoping already holds rigid; U3 only claims CLEAN, substantial, compact separations). */
const MIN_SIDE_FRAC = 0.1;
/** The detached side's bbox must be at most this fraction of the total bbox AREA — a
 *  detached detail is COMPACT; this rejects a corridor whose "smaller" side still spans
 *  most of the drawing (e.g. a vertical gutter that splits by X but keeps full Y). */
const MAX_AREA_FRAC = 0.4;
/** Confidence at/above which the caller holds the body rigid; below → WARN. */
export const CONF_MIN = 0.6;

export interface DetachedAssembly {
  bbox: { xMin: number; xMax: number; yMin: number; yMax: number };
  confidence: number;
}

type Pt = { x: number; y: number };

function bboxOf(pts: Pt[]) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts) {
    xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
  }
  return { xMin, xMax, yMin, yMax };
}

/** Scan one axis for a qualifying separating corridor; return the detached (smaller)
 *  side's bbox + confidence, or null. */
function scanAxis(pts: Pt[], axis: "x" | "y"): DetachedAssembly | null {
  const val = (p: Pt) => (axis === "x" ? p.x : p.y);
  const vals = pts.map(val);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const extent = hi - lo;
  if (extent <= 0) return null;

  const sliceW = extent / NUM_SLICES;
  const counts = new Array(NUM_SLICES).fill(0);
  for (const v of vals) counts[Math.min(NUM_SLICES - 1, Math.floor((v - lo) / sliceW))]++;
  const maxC = Math.max(...counts);
  if (maxC === 0) return null;
  const thresh = EMPTY_FRAC * maxC;

  const firstOcc = counts.findIndex((c) => c >= thresh);
  let lastOcc = -1;
  for (let s = NUM_SLICES - 1; s >= 0; s--) if (counts[s] >= thresh) { lastOcc = s; break; }
  if (firstOcc < 0 || lastOcc <= firstOcc) return null;

  const tot = bboxOf(pts);
  const totArea = Math.max(1e-9, (tot.xMax - tot.xMin) * (tot.yMax - tot.yMin));
  const minSide = MIN_SIDE_FRAC * pts.length;

  // Evaluate EVERY interior near-empty run; keep the highest-confidence one whose
  // detached side is both SUBSTANTIAL (>= minSide) and COMPACT (<= MAX_AREA_FRAC of
  // total area). This rejects a full-span gutter (not compact) and a tiny noise
  // cluster (not substantial), so a garbage "whole-drawing" candidate never survives.
  let best: DetachedAssembly | null = null;
  let i = firstOcc + 1;
  while (i < lastOcc) {
    if (counts[i] >= thresh) { i++; continue; }
    const start = i;
    let sum = 0;
    while (i < lastOcc && counts[i] < thresh) { sum += counts[i]; i++; }
    const end = i - 1; // corridor = slices [start, end], interior
    const widthUnits = (end - start + 1) * sliceW;
    if (widthUnits < MIN_CORRIDOR_FRAC * extent) continue;

    const splitCoord = lo + ((start + end + 1) / 2) * sliceW;
    const sideA = pts.filter((p) => val(p) < splitCoord);
    const sideB = pts.filter((p) => val(p) >= splitCoord);
    if (sideA.length < minSide || sideB.length < minSide) continue;

    const detached = sideA.length <= sideB.length ? sideA : sideB;
    const dbox = bboxOf(detached);
    const dArea = (dbox.xMax - dbox.xMin) * (dbox.yMax - dbox.yMin);
    if (dArea > MAX_AREA_FRAC * totArea) continue; // not a compact detail

    const emptiness = 1 - sum / (end - start + 1) / maxC;
    const widthFactor = Math.min(1, widthUnits / (CONFIDENT_FRAC * extent));
    const confidence = Math.max(0, Math.min(1, emptiness * widthFactor));
    if (!best || confidence > best.confidence) best = { bbox: dbox, confidence };
  }
  return best;
}

/** Detect detached sub-assemblies in Model_Space. Empty when nothing is confidently
 *  separated. Sorted by confidence (highest first). */
export function detectDetachedAssemblies(modelSpace: Element): DetachedAssembly[] {
  const pts: Pt[] = [];
  for (const child of Array.from(modelSpace.children)) {
    if (isAnnotationElement(child)) continue;
    const p = fastPosition(child);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
  }
  if (pts.length < 6) return [];

  const out: DetachedAssembly[] = [];
  for (const axis of ["x", "y"] as const) {
    const c = scanAxis(pts, axis);
    if (c) out.push(c);
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}
