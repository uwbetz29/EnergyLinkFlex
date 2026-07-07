/**
 * Pure geometry helpers for reading dimension-block extents from a LibreDWG SVG,
 * in Model_Space coordinates (Y-up, before the Y-flip). A dimension block lives in
 * <defs> with block-local line coords; the referencing <use href="#id" x y> offsets
 * it into Model_Space, so global bounds = line coords + the <use> offset.
 *
 * Extracted from svg-drawing-canvas.tsx so the stretch/scoping engine (and its tests)
 * can consume the same geometry without importing the React component. Behaviour is
 * identical to the originals (see dim-geometry.test.ts).
 */

/** On-axis extent of a dim block's extension lines (vertical → Y, horizontal → X),
 *  including the <use> offset. Returns null for a missing/empty/degenerate block. */
export function getDimBlockBounds(
  svgEl: SVGSVGElement,
  blockId: string,
  direction: "vertical" | "horizontal"
): { min: number; max: number } | null {
  const block = svgEl.querySelector(`[id="${blockId}"]`);
  if (!block) return null;

  const lines = block.querySelectorAll("line");
  if (lines.length === 0) return null;

  // Find the <use> that references this block to get its global position.
  let offsetX = 0;
  let offsetY = 0;
  const useEl = svgEl.querySelector(`use[href="#${blockId}"]`);
  if (useEl) {
    offsetX = parseFloat(useEl.getAttribute("x") || "0");
    offsetY = parseFloat(useEl.getAttribute("y") || "0");
  }

  let min = Infinity;
  let max = -Infinity;

  for (const line of lines) {
    if (direction === "vertical") {
      const y1 = parseFloat(line.getAttribute("y1") || "0") + offsetY;
      const y2 = parseFloat(line.getAttribute("y2") || "0") + offsetY;
      min = Math.min(min, y1, y2);
      max = Math.max(max, y1, y2);
    } else {
      const x1 = parseFloat(line.getAttribute("x1") || "0") + offsetX;
      const x2 = parseFloat(line.getAttribute("x2") || "0") + offsetX;
      min = Math.min(min, x1, x2);
      max = Math.max(max, x1, x2);
    }
  }

  if (!isFinite(min) || !isFinite(max) || min === max) return null;
  return { min, max };
}

/** Full 2D bounding box of a dim block's lines (Model_Space, Y-up), incl. the <use>
 *  offset. Unlike getDimBlockBounds (one axis), returns both axes. */
export function dimBlockBox2D(
  svgEl: SVGSVGElement,
  blockId: string
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const block = svgEl.querySelector(`[id="${blockId}"]`);
  if (!block) return null;
  const lines = block.querySelectorAll("line");
  if (lines.length === 0) return null;
  let ox = 0,
    oy = 0;
  const useEl = svgEl.querySelector(`use[href="#${blockId}"]`);
  if (useEl) {
    ox = parseFloat(useEl.getAttribute("x") || "0");
    oy = parseFloat(useEl.getAttribute("y") || "0");
  }
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (const line of lines) {
    const x1 = parseFloat(line.getAttribute("x1") || "0") + ox;
    const x2 = parseFloat(line.getAttribute("x2") || "0") + ox;
    const y1 = parseFloat(line.getAttribute("y1") || "0") + oy;
    const y2 = parseFloat(line.getAttribute("y2") || "0") + oy;
    xMin = Math.min(xMin, x1, x2);
    xMax = Math.max(xMax, x1, x2);
    yMin = Math.min(yMin, y1, y2);
    yMax = Math.max(yMax, y1, y2);
  }
  return isFinite(xMin) ? { xMin, xMax, yMin, yMax } : null;
}
