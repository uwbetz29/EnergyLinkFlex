/**
 * Pure, DOM-free coordinate remap for markups over a stretched drawing.
 *
 * Markups are stored in the drawing's ORIGINAL viewBox coordinates (Y-down).
 * The stretch engine works in internal Model_Space coordinates (Y-up):
 *   internal (ix, iy) = (x, -y);  back to viewBox: (x, y) = (ix, -iy).
 *
 * `remapPointForward` mirrors applyMultiStretch's per-element loop with the
 * markup treated as EQUIPMENT (never an annotation), consuming the SAME
 * AxisGroup[] the geometry uses — fidelity is by construction.
 * `remapPointInverse` inverts the per-axis piecewise-linear map so
 * inverse(forward(pt)) === pt for the supported (gate-free / single-axis) cases.
 */

import type { Pt } from "./markup-geometry";
import type { Markup } from "./types";
import { AXIS_TOL, placeOnAxis, type Segment } from "./axis-map";
import type { AxisGroup } from "./svg-stretch";

/** Map a base (unstretched) viewBox point to where it lands after the stretch,
 *  moving exactly like the drawing geometry at that point. */
export function remapPointForward(pt: Pt, groups: AxisGroup[]): Pt {
  const ix = pt.x;
  const iy = -pt.y;

  let sx = 1,
    sy = 1,
    rtx = 0,
    rty = 0,
    stx = 0,
    sty = 0;

  for (const g of groups) {
    // Width scoping: skip groups whose edited view excludes this point.
    if (g.viewRegion && (ix < g.viewRegion.xMin || ix > g.viewRegion.xMax)) continue;

    const c = g.axis === "y" ? iy : ix;

    // 2D cross-band scoping: out-of-band points never scale — they ride
    // rigidly on the segment's near-edge offset, like annotations.
    let inBand = true;
    if (g.crossBand) {
      const cross = g.axis === "y" ? ix : iy;
      inBand = g.crossBand.lo - AXIS_TOL <= cross && cross < g.crossBand.hi + AXIS_TOL;
    }

    const p = placeOnAxis(g.segments, c);
    const rigid = !inBand;
    const sc = rigid ? 1 : p.scale;
    const t = rigid ? p.annTranslate : p.translate;

    if (g.axis === "y") {
      sy *= sc;
      if (sc === 1) rty += t;
      else sty += t;
    } else {
      sx *= sc;
      if (sc === 1) rtx += t;
      else stx += t;
    }
  }

  const ix2 = ix * sx + rtx + stx;
  const iy2 = iy * sy + rty + sty;
  return { x: ix2, y: -iy2 };
}

/**
 * Invert a composed piecewise-linear axis map for a mapped coordinate `d`.
 * Segment S's forward image is [S.mappedStart, S.mappedStart + (S.end-S.start)*S.scale];
 * identity hole/tail regions ride the offset accumulated below them.
 */
function invertOnAxis(segments: Segment[], d: number): number {
  if (segments.length === 0 || d < segments[0].mappedStart) return d;
  let offsetBelow = 0;
  for (const s of segments) {
    // Hole below this segment: identity + accumulated offset.
    if (d < s.mappedStart) return d - offsetBelow;
    const mappedEnd = s.mappedStart + (s.end - s.start) * s.scale;
    if (d <= mappedEnd) return s.start + (d - s.mappedStart) / s.scale;
    offsetBelow = mappedEnd - s.end;
  }
  // Tail above the last segment: identity + total growth.
  return d - offsetBelow;
}

/** Exact inverse of remapPointForward for the supported cases (per-axis
 *  invertible maps; gates evaluated on the point's own coordinates). */
export function remapPointInverse(pt: Pt, groups: AxisGroup[]): Pt {
  let ix = pt.x;
  let iy = -pt.y;

  for (const g of groups) {
    // Gate viewRegion on the BASE preimage, mirroring forward's base-coordinate
    // gate: an in-view base point follows the map (so its display coord may
    // land past xMax on the tail growth); an out-of-view base point rides
    // rigid. Compute the candidate base for this axis and accept the group
    // only if that candidate is in view; otherwise identity.
    if (g.viewRegion) {
      const coord = g.axis === "y" ? iy : ix;
      const candidate = invertOnAxis(g.segments, coord);
      if (candidate < g.viewRegion.xMin || candidate > g.viewRegion.xMax) continue;
    }

    let inBand = true;
    if (g.crossBand) {
      const cross = g.axis === "y" ? ix : iy;
      inBand = g.crossBand.lo - AXIS_TOL <= cross && cross < g.crossBand.hi + AXIS_TOL;
    }

    if (g.axis === "y") {
      iy = inBand ? invertOnAxis(g.segments, iy) : invertRigid(g.segments, iy);
    } else {
      ix = inBand ? invertOnAxis(g.segments, ix) : invertRigid(g.segments, ix);
    }
  }

  return { x: ix, y: -iy };
}

/**
 * Invert the RIGID (annotation-style) map: c ↦ c + annTranslate(c), where
 * annTranslate is the near-edge offset of the region containing c (0 below the
 * first segment, mappedStart - start inside a segment, accumulated offset in
 * holes and above the tail). The map is a monotone step-offset; find the first
 * region whose image contains d.
 */
function invertRigid(segments: Segment[], d: number): number {
  if (segments.length === 0 || d < segments[0].start) return d;
  let offsetBelow = 0;
  for (const s of segments) {
    // Hole below this segment (identity + offsetBelow).
    if (d < s.start + offsetBelow) return d - offsetBelow;
    const near = s.mappedStart - s.start;
    if (d <= s.end + near) return d - near;
    offsetBelow = s.mappedStart + (s.end - s.start) * s.scale - s.end;
  }
  return d - offsetBelow;
}

/** Remap every coordinate of a markup forward, preserving identity fields. */
export function remapMarkupForward(m: Markup, groups: AxisGroup[]): Markup {
  switch (m.type) {
    case "line":
    case "arrow": {
      const p1 = remapPointForward({ x: m.x1, y: m.y1 }, groups);
      const p2 = remapPointForward({ x: m.x2, y: m.y2 }, groups);
      return { ...m, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case "text": {
      const p = remapPointForward({ x: m.x, y: m.y }, groups);
      return { ...m, x: p.x, y: p.y };
    }
  }
}
