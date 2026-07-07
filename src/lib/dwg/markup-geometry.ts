/**
 * Pure geometry helpers for the drawing-markup layer (red line/arrow/text
 * annotations laid over a sheet SVG). All coordinates are in SVG viewBox
 * units. No I/O, no randomness — deterministic functions only.
 */
import type { Markup } from "./types";

/** A 2D point in viewBox units. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Approximate per-character advance width (viewBox units) used to build a
 * text markup's hit-test bounding box. Matches a ~16px monospace-ish red
 * annotation glyph; precision doesn't matter, consistency does.
 */
export const TEXT_CHAR_W = 10;

/**
 * Approximate cap height (viewBox units) of the annotation text. The text
 * anchor (x,y) is the left end of the baseline, so the bbox extends this far
 * ABOVE the anchor.
 */
const TEXT_CAP_H = 14;

/** Guard against division by ~0 for degenerate segments. */
const EPS = 1e-9;

/** Distance from point p to the segment (x1,y1)-(x2,y2). */
function distToSegment(p: Pt, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > EPS) {
    t = ((p.x - x1) * dx + (p.y - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** True if pt falls within the given markup's geometry, expanded by tol. */
function markupContains(m: Markup, pt: Pt, tol: number): boolean {
  switch (m.type) {
    case "line":
    case "arrow":
      return distToSegment(pt, m.x1, m.y1, m.x2, m.y2) <= tol;
    case "text": {
      // Bbox anchored at (x,y): spans the text width to the right and the
      // cap height above the anchor baseline, expanded by tol on all sides.
      const w = m.text.length * TEXT_CHAR_W;
      return (
        pt.x >= m.x - tol &&
        pt.x <= m.x + w + tol &&
        pt.y >= m.y - TEXT_CAP_H - tol &&
        pt.y <= m.y + tol
      );
    }
  }
}

/**
 * Return the id of the TOP-MOST markup whose geometry is within tol of pt,
 * else null. Top-most = last in array order (later-added draws on top).
 */
export function hitTest(markups: Markup[], pt: { x: number; y: number }, tol: number): string | null {
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i];
    if (markupContains(m, pt, tol)) return m.id;
  }
  return null;
}

/** Return a NEW markup translated by (dx,dy). Never mutates the input. */
export function moveMarkup(m: Markup, dx: number, dy: number): Markup {
  switch (m.type) {
    case "line":
    case "arrow":
      return { ...m, x1: m.x1 + dx, y1: m.y1 + dy, x2: m.x2 + dx, y2: m.y2 + dy };
    case "text":
      return { ...m, x: m.x + dx, y: m.y + dy };
  }
}

/**
 * Return the two arrowhead barb points for a shaft (x1,y1)→(x2,y2) with the
 * tip at (x2,y2). Each barb sits headLen back from the tip along the shaft
 * axis, offset ±headWidth/2 along the shaft normal (symmetric about the
 * shaft). Robust to a near-zero-length shaft: falls back to a rightward
 * (+x) direction so coordinates are always finite.
 */
export function arrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number,
  headWidth: number
): Pt[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  // Unit vector along the shaft (default rightward for degenerate shafts).
  const ux = len > EPS ? dx / len : 1;
  const uy = len > EPS ? dy / len : 0;
  // Barb base: headLen back from the tip along the shaft axis.
  const bx = x2 - headLen * ux;
  const by = y2 - headLen * uy;
  // Shaft normal.
  const nx = -uy;
  const ny = ux;
  const half = headWidth / 2;
  return [
    { x: bx - half * nx, y: by - half * ny },
    { x: bx + half * nx, y: by + half * ny },
  ];
}

/**
 * Return null if the drag distance is below tol (a click, not a drag), else
 * the ordered segment {x1,y1,x2,y2} from start to end.
 */
export function normalizeDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  tol: number
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < tol) return null;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
