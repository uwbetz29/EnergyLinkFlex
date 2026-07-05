/**
 * SVG stretch/shrink engine for visual dimension modifications.
 *
 * Element-level approach: iterates ALL entities in *Model_Space,
 * classifies each by its Y-position relative to the stretch zone,
 * and applies transforms to each group:
 *   - ABOVE the zone → translate by delta (shift upward)
 *   - IN the zone → scale vertically from the zone's bottom edge
 *   - BELOW the zone → unchanged
 *
 * Trades speed for accuracy: ~2-5s on 75K elements, but every
 * element ends up in exactly the right position.
 *
 * LibreDWG SVG structure:
 *   <svg viewBox="10.8 -1332.14 1610.4 1321.34">
 *     <defs>...</defs>
 *     <g transform="matrix(1,0,0,-1,0,0)">   ← Y-axis flip
 *       <g id="*Model_Space">                  ← 75K children
 *         <g id="hex"><line/></g>
 *         <g id="hex"><path/></g>
 *         ...
 *
 * The Y-flip means internal SVG coords have positive Y = up.
 * viewBox Y goes from -1332 (top) to -11 (bottom).
 * After flip: internal Y ~11 (bottom) to ~1332 (top).
 */

export interface StretchParams {
  /** Component ID this stretch applies to */
  componentId: string;
  /** SVG coordinate bounds of the section to stretch (in viewBox space) */
  svgBounds: {
    top: number;    // min Y in viewBox space (visually higher = more negative)
    bottom: number; // max Y in viewBox space (visually lower = less negative)
    left: number;
    right: number;
  };
  /** Stretch direction */
  direction: "vertical" | "horizontal";
  /** Amount to stretch in SVG units (positive = bigger) */
  delta: number;
}

/**
 * Find the *Model_Space <g> that contains all drawing entities.
 */
export function findModelSpace(svgRoot: SVGSVGElement): SVGGElement | null {
  // Navigate: <svg> → <g transform="matrix(...)"> → <g id="*Model_Space">
  for (const child of Array.from(svgRoot.children)) {
    if (child.tagName === "g" && child.getAttribute("transform")?.includes("matrix")) {
      const ms = child.querySelector("#\\*Model_Space") as SVGGElement | null;
      if (ms) return ms;
      // Fallback: first child <g>
      if (child.children[0]?.tagName === "g") return child.children[0] as SVGGElement;
    }
  }
  return null;
}

/**
 * Save original viewBox for later restoration.
 */
export function saveOriginalViewBox(svgRoot: SVGSVGElement): void {
  const vb = svgRoot.getAttribute("viewBox");
  if (vb && !svgRoot.hasAttribute("data-original-viewbox")) {
    svgRoot.setAttribute("data-original-viewbox", vb);
  }
}

/**
 * Remove all stretches and restore original state.
 */
export function undoStretches(svgRoot: SVGSVGElement): void {
  // Remove transforms applied to Model_Space children
  const modelSpace = findModelSpace(svgRoot);
  if (modelSpace) {
    for (const child of Array.from(modelSpace.children)) {
      if (child.hasAttribute("data-stretch-transform")) {
        child.removeAttribute("transform");
        child.removeAttribute("data-stretch-transform");
      }
    }
  }

  // Restore text inverse-scaling
  const modifiedTexts = svgRoot.querySelectorAll("[data-stretch-text-orig]");
  for (const text of modifiedTexts) {
    const orig = text.getAttribute("data-stretch-text-orig");
    if (orig) {
      text.setAttribute("transform", orig);
    } else {
      text.removeAttribute("transform");
    }
    text.removeAttribute("data-stretch-text-orig");
  }

  // Restore original viewBox
  const origVb = svgRoot.getAttribute("data-original-viewbox");
  if (origVb) {
    svgRoot.setAttribute("viewBox", origVb);
  }
}

/**
 * Apply a stretch to the SVG by transforming individual elements.
 *
 * For vertical stretches:
 *   - Elements above the zone shift upward by delta
 *   - Elements in the zone scale from the bottom edge
 *   - Elements below the zone stay put
 *
 * The viewBox is expanded to accommodate the growth.
 */
/**
 * Fast position extraction from an SVG element WITHOUT calling getBBox().
 *
 * getBBox() forces a full layout recalculation — on 75K elements that takes 700s+.
 * Instead, parse position from attributes directly:
 *   - <use x="..." y="..."> → (x, y)
 *   - <line x1="..." y1="..."> → midpoint
 *   - <circle cx="..." cy="..."> → (cx, cy)
 *   - <path d="M x y ..."> → first move-to point
 *   - <text x="..." y="..."> → (x, y)
 *   - <g> with children → recurse into first child
 *
 * Returns null if position can't be determined (rare — skip the element).
 */
export function fastPosition(el: Element): { x: number; y: number } | null {
  const tag = el.tagName;

  if (tag === "use" || tag === "text" || tag === "rect" || tag === "image") {
    const x = parseFloat(el.getAttribute("x") || "");
    const y = parseFloat(el.getAttribute("y") || "");
    if (!isNaN(x) && !isNaN(y)) return { x, y };
  }

  if (tag === "line") {
    const x1 = parseFloat(el.getAttribute("x1") || "");
    const y1 = parseFloat(el.getAttribute("y1") || "");
    const x2 = parseFloat(el.getAttribute("x2") || "");
    const y2 = parseFloat(el.getAttribute("y2") || "");
    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "");
    const cy = parseFloat(el.getAttribute("cy") || "");
    if (!isNaN(cx) && !isNaN(cy)) return { x: cx, y: cy };
  }

  if (tag === "path") {
    const d = el.getAttribute("d") || "";
    const m = d.match(/[Mm]\s*([-\d.e]+)[,\s]+([-\d.e]+)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }

  if (tag === "polygon" || tag === "polyline") {
    const pts = el.getAttribute("points") || "";
    const firstPair = pts.trim().split(/[\s,]+/);
    if (firstPair.length >= 2) {
      return { x: parseFloat(firstPair[0]), y: parseFloat(firstPair[1]) };
    }
  }

  // <g> wrapper → check first child
  if (tag === "g" && el.children.length > 0) {
    return fastPosition(el.children[0]);
  }

  return null;
}

export function applySvgStretch(
  svgRoot: SVGSVGElement,
  params: StretchParams
): void {
  const { svgBounds, direction, delta } = params;
  if (Math.abs(delta) < 0.01) return;

  const modelSpace = findModelSpace(svgRoot);
  if (!modelSpace) {
    console.warn("[ELF stretch] Could not find *Model_Space");
    return;
  }

  // Parse current viewBox
  const vb = svgRoot.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4) return;
  const [vbX, vbY, vbW, vbH] = vb;

  const children = Array.from(modelSpace.children) as SVGGElement[];
  const t0 = performance.now();
  const classified = { above: 0, inZone: 0, below: 0, skipped: 0 };

  if (direction === "vertical") {
    // Convert viewBox bounds to internal (Y-flipped) coordinates
    const internalZoneTop = -svgBounds.top;       // higher Y = higher on screen
    const internalZoneBottom = -svgBounds.bottom;  // lower Y = lower on screen

    const zoneHeight = internalZoneTop - internalZoneBottom;
    if (zoneHeight <= 0) return;

    const scaleY = (zoneHeight + delta) / zoneHeight;
    const originY = internalZoneBottom;

    for (const child of children) {
      const pos = fastPosition(child);
      if (!pos) { classified.skipped++; continue; }

      // pos.y is in Model_Space coords (Y-up)
      const cy = pos.y;

      if (cy > internalZoneTop) {
        // ABOVE the stretch zone → shift upward by delta
        child.setAttribute("transform", `translate(0, ${delta})`);
        child.setAttribute("data-stretch-transform", "true");
        classified.above++;
      } else if (cy >= internalZoneBottom) {
        // IN the stretch zone → scale vertically from bottom edge
        child.setAttribute(
          "transform",
          `translate(0, ${originY * (1 - scaleY)}) scale(1, ${scaleY})`
        );
        child.setAttribute("data-stretch-transform", "true");
        classified.inZone++;
      } else {
        // BELOW the stretch zone → no change
        classified.below++;
      }
    }

    // Expand viewBox to accommodate growth
    svgRoot.setAttribute("viewBox", `${vbX} ${vbY - delta} ${vbW} ${vbH + delta}`);
  } else {
    // Horizontal stretch — svgBounds.left/right are in Model_Space X coords (no flip)
    const zoneLeft = svgBounds.left;
    const zoneRight = svgBounds.right;
    const zoneWidth = zoneRight - zoneLeft;
    if (zoneWidth <= 0) return;

    const scaleX = (zoneWidth + delta) / zoneWidth;
    const originX = zoneLeft;

    for (const child of children) {
      const pos = fastPosition(child);
      if (!pos) { classified.skipped++; continue; }

      const cx = pos.x;

      if (cx > zoneRight) {
        // RIGHT of stretch zone → shift right
        child.setAttribute("transform", `translate(${delta}, 0)`);
        child.setAttribute("data-stretch-transform", "true");
        classified.above++;
      } else if (cx >= zoneLeft) {
        // IN the stretch zone → scale horizontally
        child.setAttribute(
          "transform",
          `translate(${originX * (1 - scaleX)}, 0) scale(${scaleX}, 1)`
        );
        child.setAttribute("data-stretch-transform", "true");
        classified.inZone++;
      } else {
        classified.below++;
      }
    }

    svgRoot.setAttribute("viewBox", `${vbX} ${vbY} ${vbW + delta} ${vbH}`);
  }

  const elapsed = Math.round(performance.now() - t0);
  console.log(
    `[ELF stretch] ${children.length} elements classified in ${elapsed}ms:`,
    `above=${classified.above} inZone=${classified.inZone} below=${classified.below} skipped=${classified.skipped}`,
    `delta=${delta.toFixed(1)} direction=${direction}`
  );
}

/* ─── Dimension Parsing ─── */

/**
 * Parse engineering dimension string to decimal inches.
 * Handles: 10'-10 7/8", 15'-0 1/8", ~25'-0", 2'-10 7/8", 9'-8 3/4"
 */
export function parseDimInches(s: string): number | null {
  const clean = s.replace(/^[~Ø]/, "").trim().replace(/[""\u2033]$/, "");

  const m = clean.match(/(\d+)['\u2018\u2032][- ]?(\d+)?(?:\s+(\d+)\/(\d+))?/);
  if (m) {
    const feet = parseInt(m[1]);
    const inches = parseInt(m[2] || "0");
    const fracNum = parseInt(m[3] || "0");
    const fracDen = parseInt(m[4] || "1");
    return feet * 12 + inches + (fracDen > 0 ? fracNum / fracDen : 0);
  }

  const num = parseFloat(clean);
  if (!isNaN(num)) return num;

  return null;
}

/**
 * Format decimal inches to engineering dimension string.
 */
export function formatDimInches(totalInches: number): string {
  const feet = Math.floor(totalInches / 12);
  const remainInches = totalInches - feet * 12;
  const wholeInches = Math.floor(remainInches);
  const frac = remainInches - wholeInches;

  if (Math.abs(frac) < 0.001) {
    return `${feet}'-${wholeInches}"`;
  }

  const denoms = [16, 8, 4, 2];
  for (const d of denoms) {
    const n = Math.round(frac * d);
    if (Math.abs(n / d - frac) < 0.002 && n > 0 && n < d) {
      let num = n;
      let den = d;
      while (num % 2 === 0 && den % 2 === 0) {
        num /= 2;
        den /= 2;
      }
      return `${feet}'-${wholeInches} ${num}/${den}"`;
    }
  }

  return `${feet}'-${remainInches.toFixed(2)}"`;
}

/**
 * Determine stretch direction from a dimension key.
 */
export function dimKeyToDirection(
  dimKey: string
): "vertical" | "horizontal" | null {
  const k = dimKey.toLowerCase();
  if (k.includes("y scale") || k.includes("height") || k.includes("tall")) {
    return "vertical";
  }
  if (
    k.includes("x scale") ||
    k.includes("width") ||
    k.includes("length") ||
    k.includes("wide")
  ) {
    return "horizontal";
  }
  return null;
}

/**
 * Compute SVG coordinate bounds for a component from its percentage-based box
 * and the SVG viewBox.
 */
export function boxToSvgBounds(
  box: [number, number, number, number],
  viewBox: { minX: number; minY: number; width: number; height: number }
): StretchParams["svgBounds"] {
  return {
    left: viewBox.minX + (box[0] / 100) * viewBox.width,
    top: viewBox.minY + (box[1] / 100) * viewBox.height,
    right: viewBox.minX + ((box[0] + box[2]) / 100) * viewBox.width,
    bottom: viewBox.minY + ((box[1] + box[3]) / 100) * viewBox.height,
  };
}

/**
 * Compute stretch delta from old/new dimension values and section size.
 * Returns delta in SVG units.
 */
export function computeStretchDelta(
  oldValue: string,
  newValue: string,
  sectionSize: number
): number {
  const oldInches = parseDimInches(oldValue);
  const newInches = parseDimInches(newValue);

  if (oldInches === null || newInches === null || oldInches === 0) return 0;

  const ratio = newInches / oldInches;
  return sectionSize * (ratio - 1);
}
